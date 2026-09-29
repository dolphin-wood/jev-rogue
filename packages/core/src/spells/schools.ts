/**
 * Spell **schools**: what a spell portal's badge promises.
 *
 * Doc 003's door question was "which reward kind, and normal or elite", and
 * with four kinds that is four badges, forever. A school on a spell door is
 * the build question asked at the door — "a flame spell" is a plan the player
 * can steer toward, "a spell" is a lottery ticket — and it is still a single
 * categorical label, which is the shape of question doc 002 gives Jev.
 *
 * A school is the spell's identity, not only its element: the pool's
 * element-less spells are split by what they do.
 */
export type SpellSchool = "flame" | "frost" | "venom" | "storm" | "void" | "spirit" | "stone";

export const SPELL_SCHOOLS: readonly SpellSchool[] = ["flame", "frost", "venom", "storm", "void", "spirit", "stone"];

export const SCHOOL_OF: Readonly<Record<string, SpellSchool>> = {
  ember_dart: "flame", cinder_burst: "flame", wildfire_field: "flame",
  frost_needle: "frost", glacier_spike: "frost",
  venom_spit: "venom", plague_bloom: "venom",
  shock_arc: "storm", spark_spray: "storm", arc_lance: "storm",
  magic_bolt: "void", void_orb: "void", void_maw: "void",
  spirit_blades: "spirit", spirit_ally: "spirit", blink_strike: "spirit",
  stone_shard: "stone", stone_ward: "stone", scatter_shot: "stone", fault_line: "stone",
  frost_nova: "frost", seeker_swarm: "storm",
  earth_spikes: "stone", flame_pillars: "flame", cinder_geysers: "flame",
  mana_darts: "void", arcane_cannon: "void", doom_sigil: "void",
  frozen_orb: "frost", contagion: "venom", meteor: "flame",
  quake_ring: "stone", leap_slam: "stone",
  ball_lightning: "storm", returning_edge: "spirit", crescent_edge: "spirit", counter_stance: "spirit", dash_slash: "spirit",
  cinder_stride: "flame", toxic_cloud: "venom",
  blizzard: "frost", serpent_fang: "venom", storm_totem: "storm",
  blade_storm: "spirit", blade_recall: "spirit", blade_rift: "spirit", mortar: "stone", void_ray: "void",
};

export function schoolOf(itemId: string): SpellSchool | null {
  return SCHOOL_OF[itemId] ?? null;
}

/** The badge colour of each school, shared by the portal, the card and the staff screen. */
export const SCHOOL_COLOUR: Readonly<Record<SpellSchool, string>> = {
  flame: "#ff8a3a", frost: "#8fdcff", venom: "#8fe06a", storm: "#ffe066",
  void: "#c69cff", spirit: "#9ff0e0", stone: "#d8c8a8",
};
