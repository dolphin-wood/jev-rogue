/**
 * Sustained spell damage, for balance (task 8).
 *
 * `spell-check` fires each spell three times at one dummy, which answers
 * "does it work" and nothing about balance: a damage-over-time spell's burn
 * has not finished ticking, an area spell has one body to hit, and mana and
 * cooldowns never come into it. This casts each spell on its own key for
 * twenty seconds, whenever it can — the mana pool and regeneration of a run,
 * its own cooldown — at two targets:
 *
 * - **single**: one pinned body at 150 px;
 * - **pack**: six pinned bodies bunched at 170 px, where area and chain spells
 *   are meant to earn their keep.
 *
 * Reported per spell: damage per second on each, the first three seconds
 * (what the spell does before mana runs out), and flags for anything far off
 * the pool's median on both targets at once — a spell that is weak on one
 * body and strong on a pack is a specialist, not an outlier.
 *
 * Run: `pnpm spell-bench`
 */
import {
  createWorld, step, makeEnemy, generateRoom, toRoomPlan, runStaff, plainInstance,
  RngSource, NO_INPUT, ITEMS, STEP_MS, GRID_W, GRID_H, TILE_PX, Tile, castableAlone, attachAffix,
} from "@jr/core";
import type { Enemy, World } from "@jr/core";

const DURATION_MS = 20_000;
const BURST_MS = 3000;

const src = new RngSource("spell-bench");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("r"), { plain: true },
);
const built = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });
// An empty floor: the measurement is of the spell, not of where the kiting block landed.
const grid = built.grid.slice();
for (let y = 1; y < GRID_H - 1; y++) for (let x = 1; x < GRID_W - 1; x++) grid[y * GRID_W + x] = Tile.Floor;
const room = { ...built, grid };

const PLAYER = { x: 140, y: 208 };

function run(
  spell: string, targets: readonly [number, number][], affixes: readonly [string, number][] = [],
): { dps: number; burst: number } {
  const w: World = createWorld({
    room, encounter: null, props: 0,
    staff: runStaff(),
    slots: [plainInstance(spell), null, null],
    hearts: 999, rng: src.stream("w", spell, targets.length),
    invincible: true,
  });
  w.player.x = PLAYER.x;
  w.player.y = PLAYER.y;
  for (const [id, tier] of affixes) {
    const next = w.spells[0] ? attachAffix(w.spells[0], id, tier) : null;
    if (next) w.spells[0] = next;
  }
  const bodies: Enemy[] = targets.map(([dx, dy], i) => {
    const e = makeEnemy(w.nextEnemyId++, "rusher", PLAYER.x + dx, PLAYER.y + dy, []);
    e.spawnFadeMs = 0;
    e.hp = 1e7;
    e.maxHp = 1e7;
    e.speed = 0;
    e.awake = true;
    e.attackCooldownMs = 1e9;
    w.enemies.push(e);
    return e;
  });
  const home = bodies.map((e) => ({ x: e.x, y: e.y }));
  const aim = { x: home.reduce((t, h) => t + h.x, 0) / home.length, y: home.reduce((t, h) => t + h.y, 0) / home.length };
  let burst = 0;
  for (let t = 0; t < DURATION_MS; t += STEP_MS) {
    step(w, { ...NO_INPUT, aimX: aim.x, aimY: aim.y, spell: 0 });
    // Pinned: knockback and pulls are part of what a spell does, but a body
    // shoved out of range would measure the shove, not the damage.
    bodies.forEach((e, i) => { e.x = home[i]!.x; e.y = home[i]!.y; e.attackCooldownMs = 1e9; e.attack = "approach"; });
    // The player is held too, except while a dash spell carries them.
    if (w.player.dashMs <= 0 && w.player.strikeMs <= 0) {
      w.player.x = PLAYER.x;
      w.player.y = PLAYER.y;
    }
    if (t < BURST_MS) burst = w.stats.damageDealt;
  }
  return { dps: w.stats.damageDealt / (DURATION_MS / 1000), burst };
}

const single: [number, number][] = [[150, 0]];
const pack: [number, number][] = [[160, -26], [160, 0], [160, 26], [186, -13], [186, 13], [212, 0]];
/*
 * The close-range shapes — blades circling the caster, a dash through what is
 * in front — are measured where they are meant to be used: bodies at arm's
 * length. Measured at 150 px they read as dead, which they are there.
 */
const closeSingle: [number, number][] = [[36, 0]];
const closePack: [number, number][] = [[34, -20], [36, 0], [34, 20], [54, -12], [54, 12], [70, 0]];
const close = (id: string) => ["orbit", "dash"].includes(String(ITEMS.get(id)?.params["shape"] ?? ""))
  // A ring thrown out all round is a close answer too.
  || Number(ITEMS.get(id)?.params["spread"] ?? 0) >= 180;

const spells = [...ITEMS.values()].filter(castableAlone).filter((i) => i.kind === "attack");
const rows = spells.map((i) => {
  const a = run(i.id, close(i.id) ? closeSingle : single);
  const b = run(i.id, close(i.id) ? closePack : pack);
  return { id: i.id, mana: i.mana, single: a.dps, pack: b.dps, burst: a.burst };
});
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
const mSingle = median(rows.map((r) => r.single));
const mPack = median(rows.map((r) => r.pack));

console.log(`${rows.length} spells, each alone on a key for ${DURATION_MS / 1000}s with a run's mana; median ${mSingle.toFixed(1)} dps single, ${mPack.toFixed(1)} dps pack\n`);
console.log(`${"id".padEnd(16)} mana  single  pack   burst3s  vs median (single / pack)`);
for (const r of rows.sort((a, b) => (b.single / mSingle + b.pack / mPack) - (a.single / mSingle + a.pack / mPack))) {
  const s = r.single / mSingle;
  const p = r.pack / mPack;
  // A ward is a defence; its value is the shots and bodies it stops, which a pinned dummy cannot show.
  const defence = ITEMS.get(r.id)?.params["shape"] === "pillar";
  const flag = defence ? "  (defence: not measured by damage)" : s > 1.6 && p > 1.6 ? "  OVERTUNED" : s < 0.55 && p < 0.55 ? "  UNDERTUNED" : "";
  console.log(`${r.id.padEnd(16)} ${String(r.mana).padStart(4)}  ${r.single.toFixed(1).padStart(6)}  ${r.pack.toFixed(1).padStart(5)}  ${String(Math.round(r.burst)).padStart(7)}   ${s.toFixed(2)} / ${p.toFixed(2)}${flag}`);
}

/*
 * The affixes, on the plain bolt, at their top tier — and the pairs that
 * multiply. The question is whether any one loadout is so far ahead that the
 * rest are not worth taking, which is what `scatter + repeat` was.
 */
const LOADOUTS: readonly [string, readonly [string, number][]][] = [
  ["bare", []],
  ["repeat 3", [["repeat", 3]]],
  ["scatter 3", [["scatter", 3]]],
  ["repeat 3 + scatter 3", [["repeat", 3], ["scatter", 3]]],
  ["fork 3", [["fork", 3]]],
  ["chain 3", [["chain", 3]]],
  ["pierce 3", [["pierce", 3]]],
  ["seek 3", [["seek", 3]]],
  ["kindle 3", [["kindle", 3]]],
  ["blight 3", [["blight", 3]]],
  ["brand 3", [["brand", 3]]],
  ["harvest 3", [["harvest", 3]]],
  ["pierce 3 + chain 3", [["pierce", 3], ["chain", 3]]],
  ["kindle 3 + fork 3", [["kindle", 3], ["fork", 3]]],
];
console.log(`\naffix loadouts on magic_bolt, top tier, same 20 s:`);
console.log(`${"loadout".padEnd(24)} single  pack`);
const bare = run("magic_bolt", single);
for (const [name, affixes] of LOADOUTS) {
  const a = run("magic_bolt", single, affixes);
  const b = run("magic_bolt", pack, affixes);
  console.log(`${name.padEnd(24)} ${a.dps.toFixed(1).padStart(6)}  ${b.dps.toFixed(1).padStart(5)}   x${(a.dps / bare.dps).toFixed(2)} single`);
}
