/**
 * **The Frontier Veteran, measured on its own** (doc 024): its room at room 10's
 * ramp, a three-key build at level 6, eight seeds, one skill profile. Reports
 * each fight's end, the guardian's bar and armour at it, and what the hearts
 * went to.
 *
 * `pnpm guardian-bench [profile]`
 */
import { RngSource, createWorld, generateRoom, toRoomPlan, plainInstance, runStaff, attachAffix, withLevel, LEVEL_HEARTS, XP_TO_NEXT } from "@jr/core";
import { fight } from "../play/run.ts";
import { SKILL_PROFILES } from "../play/skill.ts";
import { emptyRoom } from "../play/playtest-log.ts";
const prof = process.argv[2] ?? "player";
let tot = 0, won = 0; const src2: Record<string, number> = {};
for (let s = 0; s < 8; s++) {
  const src = new RngSource("g" + s);
  const g = generateRoom({ space: "audience_arena", symmetry: "mirrored", size: "compact", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } }, "S", "combat", src.stream("room"));
  const staff = runStaff();
  const w = createWorld({ room: toRoomPlan(g, { id: "g", seed_key: "g" + s, reward_kind: "item", params_source: "rule" }), encounter: null, staff,
    slots: [plainInstance("magic_bolt", "a"), plainInstance("frost_needle", "b"), plainInstance("seeker_swarm", "c"), null, null, null], hearts: 6 + LEVEL_HEARTS * 5,
    xp: XP_TO_NEXT.slice(0, 5).reduce((a, b) => a + b, 0), rng: src.stream("w"), roomIndex: 10, guardian: true, placement: "waves" });
  w.spells.forEach((sl, i) => { if (sl) w.spells[i] = withLevel(attachAffix(sl, i === 0 ? "scatter" : "seek", 1) ?? sl, 3); });
  const log = emptyRoom(10, "combat");
  const g0 = w.enemies.find((e) => e.guardian)!;
  const r = fight(w, SKILL_PROFILES[prof as keyof typeof SKILL_PROFILES], 120000, false, log);
  if (r.cleared) won++;
  tot += r.ms;
  for (const [k, v] of Object.entries(log.bySource)) src2[k] = (src2[k] ?? 0) + v;
  console.log(`seed ${s}: ${r.cleared ? "won" : "lost"} ${(r.ms / 1000).toFixed(0)}s  guardian hp ${Math.round(g0.hp)}/${g0.maxHp} armour ${Math.round(g0.armour)}  hearts ${w.player.hearts.toFixed(1)}`);
}
console.log(prof, `won ${won}/8 mean ${(tot / 8000).toFixed(0)}s`, JSON.stringify(src2));
