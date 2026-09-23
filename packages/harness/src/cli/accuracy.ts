/**
 * Isolated accuracy probe: one stationary turret, an open room, the reference
 * model. Anything below a high hit rate here is an aiming bug, not a tactics
 * problem, because there is nothing to dodge and nothing to shoot around.
 */
import { createWorld, step, makeEnemy, generateRoom, toRoomPlan, staffFor, plainInstance, RngSource } from "@jr/core";

const src = new RngSource("accuracy");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("room"), { plain: true },
);
const room = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });

const w = createWorld({
  room, encounter: null,
  staff: staffFor({ slots: "many", mana: "high", tempo: "steady", special: "none" }),
  slots: [plainInstance("magic_bolt"), null, null, null, null, null],
  hearts: 6, rng: src.stream("w"),
});
w.player.x = 200;
w.player.y = 208;
const t = makeEnemy(1, "turret", 420, 208, []);
t.spawnFadeMs = 0;
t.awake = true;
t.hp = 100000;
t.maxHp = 100000;
w.enemies.push(t);

const { referenceInput } = await import("../play/player-model.ts");
for (let i = 0; i < 60 * 30; i++) step(w, referenceInput(w));

const hits = Math.round(w.stats.damageDealt / 8);
console.log(`shots ${w.stats.shotsFired}  hits ~${hits}  rate ${(100 * hits / Math.max(1, w.stats.shotsFired)).toFixed(0)}%`);
console.log(`player ended at ${Math.round(w.player.x)},${Math.round(w.player.y)} turret at ${t.x},${t.y}`);
