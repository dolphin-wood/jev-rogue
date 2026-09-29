/**
 * Which sound each spell makes, as a table.
 *
 * **Why this exists.** The first mapping was one line: the spell's school
 * picked the sound. That is the right answer for an element and the wrong one
 * for a spell, because a school is a colour and a spell is a *form*. Under it,
 * a shotgun of five stone pellets, a rock lobbed underarm and a fault opening
 * across the floor were the same noise; so were a ring of orbiting blades, a
 * summoned ally and a teleport. The screen already says which element it is —
 * the tint, the particles, the badge — and the one thing the ear could have
 * added, *what you just cast*, was the thing being thrown away.
 *
 * So the table is keyed by spell, and the question each row answers is "what
 * shape is this?" rather than "what colour is it?". A cone of pellets is a
 * shotgun whatever element it is tinted in; a field is an ignition and then
 * something quietly burning; a dash is one swish.
 *
 * **Four rows are deliberately silent on the cast.** The eruption spells —
 * earth spikes, flame pillars, cinder geysers, the quake's rings — announce
 * themselves with the bursts they make, one per column or ring, staggered
 * across a third of a second. A cast sound in front of that is a sound
 * competing with its own consequence, and the windup that precedes every cast
 * already says something is coming. The meteor is the eruption that is not:
 * its one burst is most of a second after the press.
 *
 * **Pitch is used instead of a new file** where two spells are honestly the
 * same event at two sizes: a needle and a glacier spike are both frost
 * arriving, one small and quick and one heavy and slow, and a playback rate
 * says that better than two nearly identical wavs would.
 */
import type { SfxName } from "./sfx.ts";
import { schoolOf } from "../spells/schools.ts";

export interface SpellSound {
  /** What leaves the hand, or null where the spell's own effects are the sound. */
  readonly cast: SfxName | null;
  /** Playback rate for the cast: the same event at a different size. */
  readonly castPitch?: number;
  /** The tail added to the weight hit when this spell's shot lands. */
  readonly impact: SfxName | null;
  /** The tail's playback rate. */
  readonly impactPitch?: number;
}

/**
 * Every attack in the pool. The comment on each row is its *form* — which is
 * what the sound is chosen for.
 */
export const SPELL_SFX: Readonly<Record<string, SpellSound>> = {
  /* ---- single projectiles: the cast is small, the hit carries the school --- */

  // A plain quick bolt. No impact tail at all: the weight hit is the whole
  // event, and this is the spell cast most often in the game by a distance.
  magic_bolt: { cast: "cast_arcane", castPitch: 1.12, impact: null },
  // A short-lived spark that leaps between bodies.
  shock_arc: { cast: "cast_storm", castPitch: 1.1, impact: "impact_storm" },
  // A three-shot fan of sparks at close range: the discharge, smaller and
  // quicker, rather than a separate sound for what is the same material.
  spark_spray: { cast: "cast_storm", castPitch: 1.35, impact: "impact_storm", impactPitch: 1.2 },
  // One heavy rock, lobbed. A throw, not an eruption.
  stone_shard: { cast: "cast_shard", impact: "impact_stone" },
  // A small dart of fire.
  ember_dart: { cast: "cast_flame", castPitch: 1.3, impact: "impact_flame", impactPitch: 1.15 },
  // A thin needle of ice.
  frost_needle: { cast: "cast_frost", castPitch: 1.15, impact: "impact_frost", impactPitch: 1.15 },
  // A heavy spike of ice: the same event, slowed and dropped.
  glacier_spike: { cast: "cast_frost", castPitch: 0.82, impact: "impact_frost", impactPitch: 0.85 },
  // A spit of venom.
  venom_spit: { cast: "cast_venom", impact: "impact_venom" },
  // Three of them, in a spread.
  plague_bloom: { cast: "cast_venom", castPitch: 1.12, impact: "impact_venom", impactPitch: 1.1 },
  // Two cinders in a tight pair.
  cinder_burst: { cast: "cast_flame", castPitch: 1.15, impact: "impact_flame" },
  // A lance of current that pierces: a line, thrown.
  arc_lance: { cast: "cast_lance", impact: "impact_storm", impactPitch: 0.9 },
  // A heavy orb that pulls: the launch is felt rather than heard.
  void_orb: { cast: "cast_orb", impact: "impact_void" },

  /* -------------------- forms that are not a projectile ------------------- */

  // A cone of five pellets: a shotgun.
  scatter_shot: { cast: "cast_scatter", impact: "impact_stone", impactPitch: 1.25 },
  // Eleven shards leaving at once, in every direction.
  frost_nova: { cast: "cast_nova", impact: "impact_frost", impactPitch: 1.1 },
  // Four darts that seek: wings, not a volley.
  seeker_swarm: { cast: "cast_swarm", impact: "impact_storm", impactPitch: 1.3 },
  // Blades taking up an orbit and staying there.
  spirit_blades: { cast: "cast_orbit", impact: null },
  // A teleport with a blow on the end of it.
  blink_strike: { cast: "cast_blink", impact: null },
  // Ground set alight, and then quietly burning.
  wildfire_field: { cast: "cast_field", impact: "impact_flame", impactPitch: 1.2 },
  // A vortex that pulls bodies in: the school sound *is* the form here.
  void_maw: { cast: "cast_void", impact: "impact_void", impactPitch: 1.15 },
  // An ally called in.
  spirit_ally: { cast: "cast_summon", impact: null },
  // A fault tearing along the floor.
  fault_line: { cast: "cast_rift", impact: "impact_stone", impactPitch: 0.9 },
  // A pillar of stone put up between you and them.
  stone_ward: { cast: "cast_ward", impact: null },

  /* -------------------------- eruptions: no cast -------------------------- */

  earth_spikes: { cast: null, impact: "impact_stone" },
  flame_pillars: { cast: null, impact: "impact_flame" },
  cinder_geysers: { cast: null, impact: "impact_flame", impactPitch: 1.1 },
  // Rings of broken ground: the spikes' thud, a little lower. The rings are
  // the sound, one per ring, and the windup already said a cast is coming.
  quake_ring: { cast: null, impact: "impact_stone", impactPitch: 0.85 },

  /* ------------------- the newer options on existing shapes ------------------- */

  /*
   * A rock called down on a mark. Not silent like the other eruptions: the
   * landing is most of a second away, and a cast that says nothing leaves the
   * player unsure the key took. The fire's falling note, slowed — something
   * big on its way down — and the landing is the fire burst with a rock's
   * thud under it (`playWorldSounds`).
   */
  meteor: { cast: "cast_flame", castPitch: 0.72, impact: "impact_flame", impactPitch: 0.8 },
  // Darts in a volley: the swarm's wings, lighter.
  mana_darts: { cast: "cast_swarm", castPitch: 1.15, impact: "impact_void", impactPitch: 1.3 },
  // A charged shot released: the heavy orb's launch, dropped, and lower still
  // the longer it was held (`playWorldSounds`); the charge filling is chimed.
  arcane_cannon: { cast: "cast_orb", castPitch: 0.85, impact: "impact_void", impactPitch: 0.85 },
  // A bolt that leaves a mark: the school's own voice. The burst is the tail, dropped.
  doom_sigil: { cast: "cast_void", castPitch: 0.9, impact: "impact_void", impactPitch: 0.9 },
  // A slow orb of ice: the frost cast, slowed; its ring of shards is the nova's.
  frozen_orb: { cast: "cast_frost", castPitch: 0.8, impact: "impact_frost", impactPitch: 1.2 },
  // A heavy glob of venom; the jump off a dying carrier is the spit, pitched up.
  contagion: { cast: "cast_venom", castPitch: 0.85, impact: "impact_venom", impactPitch: 0.9 },
  // A leap with a landing on the end of it: the blink's lift, dropped. The
  // landing is a stone thud and then the ring's own bursts.
  leap_slam: { cast: "cast_blink", castPitch: 0.85, impact: "impact_stone", impactPitch: 0.8 },

  /* ------------------------------ the newer shapes ------------------------------ */

  // A slow ball of current let loose: the heavy orb's launch, lighter; each
  // strike it makes lands as a storm tail.
  ball_lightning: { cast: "cast_orb", castPitch: 1.25, impact: "impact_storm", impactPitch: 1.1 },
  // A spectral sword thrown to come back: the whirl of blades taking flight.
  returning_edge: { cast: "cast_orbit", castPitch: 1.1, impact: null },
  // The sword taking an enchant: the spirit's breath. Each wave is heard in the swing that throws it.
  crescent_edge: { cast: "cast_spirit", castPitch: 0.95, impact: null },
  // A guard going up: the spirit's breath, higher and shorter than the enchant's.
  counter_stance: { cast: "cast_spirit", castPitch: 1.25, impact: null },
  // A run with the blade out: the blink's rush, a little lower, since it carries the sword.
  dash_slash: { cast: "cast_blink", castPitch: 0.9, impact: null },
  // The ground behind the caster catching: an ignition, and then burning.
  cinder_stride: { cast: "cast_field", castPitch: 1.1, impact: "impact_flame", impactPitch: 1.2 },
  // A cloud of poison: the venom's wet bubble, lowered, rather than a fire's ignition.
  toxic_cloud: { cast: "cast_venom", castPitch: 0.78, impact: "impact_venom", impactPitch: 0.85 },
};

/** The school's voice, for anything the table above does not name. */
const BY_SCHOOL: Readonly<Record<string, SpellSound>> = {
  flame: { cast: "cast_flame", impact: "impact_flame" },
  frost: { cast: "cast_frost", impact: "impact_frost" },
  venom: { cast: "cast_venom", impact: "impact_venom" },
  storm: { cast: "cast_storm", impact: "impact_storm" },
  stone: { cast: "cast_stone", impact: "impact_stone" },
  void: { cast: "cast_void", impact: "impact_void" },
  spirit: { cast: "cast_spirit", impact: null },
};

const FALLBACK: SpellSound = { cast: "cast_arcane", impact: null };

/**
 * What this spell sounds like. Falls back to its school, and then to the
 * arcane chime, so a spell added tomorrow makes a sound today.
 */
export function spellSound(itemId: string): SpellSound {
  const named = SPELL_SFX[itemId];
  if (named) return named;
  const school = schoolOf(itemId);
  return (school ? BY_SCHOOL[school] : null) ?? FALLBACK;
}

/**
 * **What a shape's own events sound like** (the world's `"spell"` events,
 * doc 006): the moments of a spell that are neither its cast nor a hit.
 *
 * `cast` means the spell's own cast sound from `SPELL_SFX`: an orb let loose,
 * a trail, an enchant or a guard started. A pressed cast is already heard on
 * its key's cooldown starting; the event is what makes a free one — an
 * affix's `resonance` or `retort` — heard too, and the scene plays each cast
 * once. Everything else is an existing sound at the size of the event:
 *
 * - an orb's strike is the storm's tail, small and bright: several a second;
 * - a returning blade turning is a light whoosh, pitched up, and caught it is
 *   the spirit's breath, short — the blade going back into the hand;
 * - an enchant's wave is the spirit's breath over the swing that throws it;
 * - a guard taking a blow is steel eating it, the armour's ring: the blow
 *   did not land, and the player has to hear that it did not;
 * - the answer is the spin's whoosh, and the weak answer of a guard that ran
 *   out is the same whoosh, higher and lighter;
 * - a beam's tick burning into a body is the void's own impact, high and
 *   light: it comes eight times a second, so it is a sizzle, not a blow;
 * - a charge's shield going up is a breath of light; a blow it holds rings
 *   thinner than a guard's; and it breaking is the frost's shatter, high and
 *   sharp — something brittle giving way, which the player has to hear
 *   because the next blow is theirs.
 */
export type ShapeEventSound = { readonly name: SfxName; readonly pitch: number } | "cast" | null;

export function shapeEventSound(what: string, share = 1): ShapeEventSound {
  switch (what) {
    case "orb": case "trail": case "enchant": case "stance": return "cast";
    case "orb_strike": return { name: "impact_storm", pitch: 1.35 };
    case "boomerang_turn": return { name: "swing_light", pitch: 1.45 };
    case "boomerang_caught": return { name: "cast_spirit", pitch: 1.6 };
    // The run's last cut throws its wave heavier (`share` 2): the same voice, well down.
    case "wave": return { name: "cast_spirit", pitch: share >= 2 ? 0.95 : 1.45 };
    case "stance_guard": return { name: "hit_armour", pitch: 1.15 };
    case "stance_answer": return { name: "swing_spin", pitch: share >= 1 ? 1 : 1.25 };
    case "beam_hit": return { name: "impact_void", pitch: 1.6 };
    case "charge_shield": return { name: "cast_spirit", pitch: 1.75 };
    case "charge_shield_hit": return { name: "hit_armour", pitch: 1.45 };
    case "charge_shield_break": return { name: "impact_frost", pitch: 1.3 };
    default: return null;
  }
}
