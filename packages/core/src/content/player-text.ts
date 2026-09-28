/**
 * **What each thing does, written for the player.**
 *
 * One of two voices. Core's own `description` on a spell, an affix or a stat
 * is the neutral fact the Director is sent (doc 006, "What a spell tells
 * Jev"): what the thing does, never who it suits or how it ranks, because a
 * verdict in an option hands Jev the answer to the question it is asked
 * (finding 11). This table is the other voice, the card text the player
 * reads, and nothing here reaches the Director — `cardPool` writes its
 * options from core's descriptions, and only the game's English content table
 * reads this one.
 *
 * It lives in core so `offer.test.ts` can check that every card any pool can
 * offer has a player line. Names are core's own (`BaseItem.name`,
 * `SpellAffix.name`, `StatUpgrade.name`) and are not repeated here. An id
 * with no entry falls back to core's own description.
 */
export const PLAYER_TEXT: Readonly<Record<string, string>> = {
  magic_bolt: "A quick single shot. Costs the least mana of any spell.",
  shock_arc: "A spark that jumps from its target to up to 2 nearby enemies, dealing half damage with each jump.",
  spark_spray: "Sprays a short fan of sparks in front of you.",
  stone_shard: "Lobs a shard of stone. Highest single-hit damage among common attack spells.",
  earth_spikes: "Stone spikes burst up in a line, one after another, staggering enemies they hit.",
  flame_pillars: "Fire pillars rise in a line, one after another, leaving the ground burning for a while.",
  cinder_geysers: "Fire erupts under your target and around it, one burst after another.",
  ember_dart: "Sets the target on fire.",
  frost_needle: "Chills the target, slowing it.",
  venom_spit: "Applies stacking poison. The faster you cast, the more it stacks.",
  arc_lance: "Throws a fast lance of lightning that pierces enemies.",
  scatter_shot: "Fires a cone of pellets. More of them hit at close range.",
  cinder_burst: "Fires two burning embers. High mana cost.",
  glacier_spike: "Fires a huge spike of ice that slows enemies it hits.",
  void_orb: "Sends out a slow orb that passes through everything and knocks enemies back. Long cooldown.",
  plague_bloom: "Scatters spores that poison enemies on contact.",
  spirit_blades: "Three spirit blades circle you, cutting enemies they touch. Casting again resets them; they do not stack.",
  wildfire_field: "Sets the ground under the nearest enemy on fire. Enemies that enter it burn until the fire dies down.",
  blink_strike: "Dash forward, striking every enemy in your path. Invulnerable during the dash.",
  void_maw: "Opens a vortex under the nearest enemy that pulls nearby enemies in for a few seconds, damaging them.",
  spirit_ally: "Summons a spirit that follows you and shoots the nearest enemy for a while.",
  frost_nova: "A ring of ice bursts out around you, freezing nearby enemies. Only reaches enemies close to you.",
  seeker_swarm: "Releases a swarm of darts that home in on enemies and never miss. Costly against a single target.",
  fault_line: "Drives a blade of stone through every enemy in a straight line.",
  stone_ward: "Raises a stone pillar in front of you that pushes back and damages nearby enemies. Blocks enemies and shots until destroyed.",
  mana_darts: "Stores a dart while not casting, up to 5. Casting fires all stored darts in a fan that seeks enemies ahead.",
  arcane_cannon: "Hold to charge, release to fire a piercing shot that grows with the charge. A full charge staggers. You move slower while charging; dashing cancels the charge at no mana cost.",
  doom_sigil: "Marks the enemy hit. After a few seconds the mark bursts, damaging that enemy and those around it. A marked enemy can't be marked again until the mark bursts.",
  frozen_orb: "Fires a slow orb of ice that passes through enemies, throwing off ice shards as it flies and bursting into a ring of shards at the end.",
  contagion: "Fires a glob of heavy poison. When a poisoned enemy dies, the poison spreads to several nearby enemies, and on from them.",
  meteor: "Marks the ground under an enemy. Moments later a meteor lands there and sets the ground on fire. Enemies can walk out of the mark.",
  quake_ring: "Rings of broken ground burst out around you, one after another, staggering enemies they hit.",
  leap_slam: "Leap at an enemy and land in a ring of broken ground. Invulnerable while airborne.",
  ball_lightning: "Releases a slow-drifting orb that shocks the nearest enemy in range several times a second. Several can be out at once; when at the limit, a new one replaces the oldest.",
  returning_edge: "Throws a spectral sword that slows, turns and flies back to you, hitting each enemy once on the way out and once on the way back.",
  crescent_edge: "For a while, every sword swing also sends a crescent wave forward that pierces all enemies in range, hit or miss. Casting again resets the duration.",
  counter_stance: "Take a brief stance: you move slower and can't swing. The next hit that would land on you is cancelled and answered with a staggering spin slash. If nothing hits you, a weaker spin slash fires when the stance ends.",
  dash_slash: "Dash forward with your sword held out, striking every enemy in your path. Sword energy rolls out on both sides of the dash and strikes what it crosses. Invulnerable during the dash.",
  cinder_stride: "For a few seconds, each step leaves a patch of fire behind you. Standing still leaves nothing. Your own fire can't hurt you.",
  toxic_cloud: "Releases a cloud of poison under the nearest enemy that poisons and slows enemies inside it.",

  /* -------------------------------- affixes ------------------------------ */
  fork: "On hit, the shot splits into shards that keep flying forward.",
  chain: "On hit, releases a smaller, weaker copy of the spell at the next nearby enemy.",
  brand: "The first hit applies a mark; the second hit detonates it.",
  harvest: "Enemies killed by this spell explode.",
  bloom: "Where the shot ends, the ground catches fire and burns enemies on it. Works even on a miss.",
  shatter: "Hitting walls or obstacles also throws shards.",
  repeat: "Shortly after you cast, the spell casts again in the direction you're aiming.",
  scatter: "The spell also fires out to every side.",
  ward: "Casting leaves a rune at your feet that blocks enemy shots.",
  retort: "When you take damage, casts this spell at the attacker at no mana cost.",
  slipstream: "Dashing through an enemy casts this spell at it.",
  pierce: "The shot passes through enemies it hits.",
  seek: "The shot curves toward the nearest enemy.",
  ricochet: "The shot bounces off walls.",
  kindle: "This spell deals fire: its hits build up burn.",
  rime: "This spell deals ice: its hits build toward a freeze, and a frozen enemy shatters for triple damage.",
  blight: "This spell deals poison: its hits build up poison that slows and wears enemies down.",
  haste: "Killing with this spell brings it back sooner.",
  resonance: "Every few sword hits, casts this spell at the enemy you struck at no mana cost.",
  momentum: "Each enemy your dash cuts through carries the dash further, up to three times.",
  undertow: "The sword energy on both sides of your dash pulls enemies in toward its path instead of knocking them away.",
  finale: "When your dash ends, it throws a crescent of sword energy forward that hits every enemy in its reach.",

  /* --------------------------------- stats ------------------------------- */
  fleet: "Move faster.",
  second_wind: "Your dash comes back sooner.",
  long_stride: "Your dash goes further.",
  wrath: "+1 rage segment, so you can store one more spin attack.",
  vigour: "More max health, and a full heal.",
  steady_nerve: "Longer invulnerability after you're hit.",
  deep_well: "More max mana.",
  quickening: "Mana comes back faster on its own.",
  leeching_edge: "Sword hits give back more mana.",
  keen_edge: "Your sword hits harder.",
  long_reach: "Your sword swings reach further.",
  swift_hand: "Shorter recovery after a swing and between combo hits.",
};

/** A thing's player-facing line, or `fallback` — core's own, designer-facing one. */
export function playerText(id: string, fallback = ""): string {
  return PLAYER_TEXT[id] ?? fallback;
}
