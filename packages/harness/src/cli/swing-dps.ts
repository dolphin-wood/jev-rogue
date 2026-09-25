/**
 * How long the sword takes to kill each archetype, with no dodging.
 *
 * "Cannot win fights" needs a number before it needs a fix. This swings on a
 * fixed cadence at a stationary target and reports the time to kill against
 * the attrition the player is taking meanwhile.
 */
import {
  createWorld, step, makeEnemy, generateRoom, toRoomPlan,
  plainInstance, RngSource, NO_INPUT, ENEMIES, SWING_TOTAL_MS, SWING_DAMAGE,
} from "@jr/core";
import type { EnemyId } from "@jr/core";

const src = new RngSource("dps");
const g = generateRoom(
  { space: "open_arena", symmetry: "mirrored", size: "standard", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
  "S", "combat", src.stream("r"), { plain: true },
);
const room = toRoomPlan(g, { id: "r", seed_key: "k", reward_kind: "item", params_source: "rule" });

console.log(`swing: ${SWING_DAMAGE} damage every ${Math.round(SWING_TOTAL_MS)} ms at best\n`);
console.log("archetype   hp   swings  seconds");
for (const id of Object.keys(ENEMIES) as EnemyId[]) {
  const w = createWorld({
    room, encounter: null,
    staff: { slots: 6, mana_max: 120 },
    slots: [plainInstance("magic_bolt"), null, null, null, null, null],
    hearts: 999, rng: src.stream("w", id),
  });
  w.player.x = 300;
  w.player.y = 208;
  w.player.facing = 0;
  const e = makeEnemy(1, id, 320, 208, []);
  e.spawnFadeMs = 0;
  e.awake = true;
  w.enemies.push(e);
  const hp = e.hp;

  let ms = 0, swings = 0;
  const period = Math.ceil(SWING_TOTAL_MS / (1000 / 60)) + 1;
  for (let i = 0; i < 60 * 40 && e.hp > 0; i++) {
    const doSwing = i % period === 0;
    if (doSwing) swings++;
    // Held in place so the measurement is of damage, not of chasing.
    e.x = 320; e.y = 208; e.knockX = 0; e.knockY = 0;
    step(w, { ...NO_INPUT, swing: doSwing });
    ms += 1000 / 60;
  }
  console.log(
    `${id.padEnd(10)} ${String(Math.round(hp)).padStart(3)} ${String(swings).padStart(7)} ${(ms / 1000).toFixed(1).padStart(8)}`,
  );
}
