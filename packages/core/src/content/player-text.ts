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
  stone_ward: "A pillar that shoves enemies back and blocks enemies and shots until it breaks.",
  mana_darts: "Banks a dart while you're not casting, up to 5; casting fires them all in a seeking fan.",
  arcane_cannon: "Hold to charge, release to fire. The shot grows the longer you hold; a full charge staggers.",
  doom_sigil: "Marks the enemy hit; a few seconds later the mark bursts on it and those around it.",
  frozen_orb: "A slow orb of ice that sheds shards as it flies and bursts into a ring of them at the end.",
  contagion: "Heavy poison. When a poisoned enemy dies, the poison jumps to the enemies near it.",
  meteor: "Marks the ground under an enemy; a burning rock lands there a moment later. Enemies can walk out.",
  quake_ring: "Rings of broken ground burst out around you, one after another, staggering enemies they hit.",
  leap_slam: "Leap at an enemy and land in a ring of broken ground. Invulnerable while airborne.",
  ball_lightning: "A slow orb that zaps the nearest enemy in reach. A few can be out; a new one replaces the oldest.",
  returning_edge: "Throws a spectral sword that comes back to you, cutting each enemy on the way out and back.",
  crescent_edge: "For a while, each sword swing also throws a crescent wave through the enemies ahead. Recast to renew it.",
  counter_stance: "A brief guard: the next hit on you is cancelled and answered with a staggering spin.",
  dash_slash: "Dash through enemies, sword out; its wake cuts those to either side. Invulnerable while dashing.",
  cinder_stride: "For a few seconds, you leave fire behind you as you walk. It never burns you.",
  toxic_cloud: "Releases a cloud of poison under the nearest enemy that poisons and slows enemies inside it.",
  blizzard: "Lays frost under the nearest enemy that slows enemies inside it and builds toward freezing them.",
  storm_totem: "Sets a totem beside you that charges up and zaps up to four enemies in reach at once. Up to two totems.",
  blade_recall: "Each sword hit leaves a blade in the foe, up to six; press to call them all back through everything.",
  blade_storm: "Adds a blade to a ring circling you that grows wider and faster; the sixth flings every blade out at nearby foes.",
  blade_rift: "Opens a whirl of blades on the floor ahead that spins in place, cutting anything standing in it.",
  mortar: "Lobs a shell over everything to the nearest enemy, bursting where it lands. Enemies can walk out.",
  void_ray: "Hold to burn every enemy along your aim, up to the first wall. You move slowly while holding.",

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
  repulse: "Casting knocks nearby enemies back, giving you room.",
  parting: "Each dash casts this spell at the nearest enemy from where you started, at no mana cost.",
  aftershock: "A moment after you cast, the ground under the nearest enemy bursts, hitting everything around it.",
  whirl: "Your spin attack casts this spell at up to three nearby enemies at no mana cost.",
  spillover: "Enemies killed by this spell pass their burn, chill and poison to enemies nearby.",
  drag: "Hits pull enemies toward you instead of knocking them away.",
  lodestar: "The spell lands under the nearest enemy instead of where you aim.",
  intercept: "This spell's shots and blades destroy enemy shots they touch.",
  cull: "Hits finish off enemies left at a sixth of their health or less. Bosses are immune.",
  overload: "Enemies this spell keeps hitting get struck by lightning, hitting whatever is next to them.",
  slam: "Enemies this spell knocks into a wall take damage and stagger.",
  afterimage: "When the pull, companion or orb runs out, it is cast once more at the nearest enemy at no mana cost.",

  /* --------------------------------- stats ------------------------------- */
  fleet: "Move faster.",
  second_wind: "Your dash comes back sooner.",
  long_stride: "Your dash goes further.",
  wrath: "More rage segments, so you can store more spin attacks.",
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
