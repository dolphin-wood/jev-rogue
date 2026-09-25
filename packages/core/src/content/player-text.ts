/**
 * **What each thing does, written for the player.**
 *
 * Core's own `description` on a spell, an affix or a stat is written for a
 * designer choosing what to build next: "at the lowest mana cost in the attack
 * pool", "suits a spam build", "the only stat that improves every part of the
 * game at once, which is why its step is the smallest in the pool". Those are
 * verdicts about the pool, and two readers of them were getting the answer to
 * their own question handed to them — the player, on a card, and the Director,
 * in an option (finding 11).
 *
 * So this table is the other voice: what the thing does, in a line, with
 * nothing in it about which build it suits or where it sits in the pool. It
 * lives in core because both readers are here — `cardPool` writes the
 * Director's options from it, and the game's English content table is this
 * table — and because a description the player reads and a description Jev
 * reads drifting apart is how the verdict got in the first time.
 *
 * Names are core's own (`BaseItem.name`, `SpellAffix.name`, `StatUpgrade.name`)
 * and are not repeated here. An id with no entry falls back to core's own
 * description, which is a line in the wrong voice rather than no line.
 */
export const PLAYER_TEXT: Readonly<Record<string, string>> = {
  magic_bolt: "A quick single shot. The cheapest spell you have.",
  shock_arc: "A spark that jumps from its target to up to two more nearby, weaker with each jump. Best when enemies bunch up.",
  spark_spray: "A short fan of sparks in front of you.",
  stone_shard: "Lobs a shard of stone. The hardest-hitting common attack.",
  earth_spikes: "Stone spikes burst up in a line, one after another, staggering whatever they catch. Best when enemies line up.",
  flame_pillars: "Fire columns rise in a line, one after another, and leave the ground burning for a while.",
  cinder_geysers: "Fire erupts under your target and all around it, one burst after another. Made for crowds.",
  ember_dart: "Sets its target on fire.",
  frost_needle: "Chills and slows its target.",
  venom_spit: "Leaves poison that stacks. The faster you cast, the deeper it builds.",
  arc_lance: "A fast bolt of lightning that goes straight through enemies.",
  scatter_shot: "A cone of pellets. The closer you are, the more of them land.",
  cinder_burst: "Fires two burning embers. Hungry for mana.",
  glacier_spike: "A huge spike of ice that slows whatever it hits.",
  void_orb: "A slow, heavy orb that passes through everything and knocks enemies aside. Long cooldown.",
  plague_bloom: "Scatters spores that poison on contact.",
  spirit_blades: "Three blades circle you, cutting everything they touch. Casting again resets them rather than adding more. Dive into a crowd.",
  wildfire_field: "Sets the ground on fire under the nearest enemy. Anything that walks in burns until it dies down.",
  blink_strike: "Dash forward through enemies, cutting each one on the way. You can't be hit mid-dash.",
  void_maw: "Opens a vortex under the nearest enemy that drags everything nearby into it for a few seconds, hurting as it pulls. Gathers a room for your sword.",
  spirit_ally: "Summons a spirit that follows you and shoots the nearest enemy for a while. You dodge, it shoots.",
  frost_nova: "A ring of ice bursts out around you and freezes everything close. Your way out when surrounded; useless at range.",
  seeker_swarm: "A swarm of darts that hunt enemies on their own. Pricey against one target, but never misses.",
  fault_line: "Drives a blade of stone through everything in a straight line. Great down a corridor, ordinary against one.",
  stone_ward: "Raises a stone pillar in front of you that shoves and hurts enemies beside it. Blocks enemies and bullets until it breaks.",
  mana_darts: "Banks a dart while you leave the key alone, up to five. A press fires every banked dart at once, and they seek the enemy in front.",
  arcane_cannon: "Hold to charge, release to fire a shot that pierces enemies and grows with the charge. A full charge staggers. You move slowly while charging; dashing cancels it and costs nothing.",
  doom_sigil: "Marks the enemy it hits. A few seconds later the mark bursts, hurting it and anything beside it. A marked enemy can't be marked again until it bursts.",
  frozen_orb: "A slow orb of ice that passes through enemies, spraying ice shards as it flies and bursting into a ring of them at the end.",
  contagion: "Heavy poison. When a poisoned enemy dies, the poison jumps to a few enemies nearby, and on from them.",
  meteor: "Marks the ground under an enemy; a moment later a burning rock lands there and leaves the ground on fire. Enemies can walk out of the mark.",
  quake_ring: "Rings of broken ground burst out around you, one after another, staggering whatever they hit.",
  leap_slam: "Leap at an enemy, untouchable in the air, and land in a ring of broken ground.",
  ball_lightning: "A slow orb drifts out of your hand and strikes the nearest enemy in reach several times a second. A few can be out at once; a new one replaces the oldest.",
  returning_edge: "Throws a spectral sword ahead that slows, turns and flies back to you, cutting each enemy once on the way out and once on the way back.",
  crescent_edge: "For a while, every sword swing also throws a crescent wave ahead that passes through every enemy in its reach, whether the swing lands or not. Casting again renews it.",
  counter_stance: "A short guard: you slow down and can't swing. The next hit that would land is cancelled and answered with a spin slash that staggers. If nothing hits you, it answers weaker as it ends.",
  cinder_stride: "For a few seconds the ground catches fire behind you as you move: a patch for every stride, nothing while you stand still. Your own fire never burns you.",
  toxic_cloud: "A cloud of poison under the nearest enemy that poisons and slows everything standing in it.",

  /* -------------------------------- affixes ------------------------------ */
  fork: "On hit, the shot breaks into shards that keep flying forward.",
  chain: "The hit releases a smaller, weaker copy of the spell at the next enemy nearby. The tighter they pack, the better.",
  brand: "The first hit marks; the second sets the mark off. Rewards sticking to one target.",
  harvest: "Enemies killed by this spell burst apart.",
  echo: "Killing with this spell refunds the mana for the next cast.",
  bloom: "Where the shot runs out, the ground catches fire and burns whatever stands in it. Even a miss does something.",
  shatter: "Hitting walls and clutter throws shards too. The messier the room, the better.",
  repeat: "A beat after you cast, the spell fires again wherever you're aiming then.",
  scatter: "The spell also fires out to every side. Your answer to being surrounded.",
  ward: "Casting leaves a rune at your feet that blocks enemy shots.",
  retort: "When you're hit, this spell fires back at whoever hit you, for free.",
  slipstream: "Dodge-rolling through an enemy hits it.",
  pierce: "The shot keeps going through what it hits.",
  seek: "The shot curves toward the nearest enemy.",
  ricochet: "Walls bounce the shot back into the room.",
  kindle: "This spell deals fire: its hits build up burn.",
  rime: "This spell deals ice: its hits build toward a freeze, and a frozen enemy shatters for triple damage.",
  blight: "This spell deals poison: its hits build up poison that slows and wears enemies down.",
  haste: "Killing with this spell brings it back sooner.",
  resonance: "Every few sword hits cast this spell at the enemy you struck, for free.",

  /* --------------------------------- stats ------------------------------- */
  fleet: "Move faster.",
  second_wind: "Your dodge roll comes back sooner.",
  long_stride: "Your dodge roll goes further.",
  wrath: "One more rage segment, so you can bank another spin attack.",
  vigour: "More max health, and a full heal.",
  steady_nerve: "Longer invulnerability after you're hit.",
  deep_well: "More max mana.",
  quickening: "Mana comes back faster on its own.",
  leeching_edge: "Sword hits give back more mana.",
  keen_edge: "Your sword hits harder.",
  long_reach: "Your sword swings reach further.",
  swift_hand: "You recover faster after a swing, so you swing more often.",
};

/** A thing's player-facing line, or `fallback` — core's own, designer-facing one. */
export function playerText(id: string, fallback = ""): string {
  return PLAYER_TEXT[id] ?? fallback;
}
