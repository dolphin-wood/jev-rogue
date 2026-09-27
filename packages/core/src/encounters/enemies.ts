/**
 * The six enemy archetypes (design doc 005, "Enemy archetypes").
 *
 * An enemy is data: a movement behaviour, a bullet pattern and stats. Threat
 * weight is the only field the pressure formula reads; it is an estimate until
 * the harness (011) calibrates it against hearts lost.
 */
import type { EnemyArchetype, EnemyId, PatternNode, AssemblableId, BaseEnemyId, EliteAffix, MeleeKind } from "../types.ts";
import { burst, fan, parallel, rest, ring, sequence, single, spiral } from "./patterns.ts";

/* ------------------------------- caps (005) ------------------------------- */

/** Enemy bullets: a volley that would exceed this is skipped entirely. */
export const ENEMY_BULLET_CAP = 600;
/** Player bullets: oldest recycled when the pool is exhausted. */
export const PLAYER_BULLET_POOL = 900;
/** Default bullet lifetime in seconds. */
export const BULLET_LIFETIME_S = 6;
/** Concurrent enemies never exceed this (doc 005, "Validation"). */
export const MAX_CONCURRENT_ENEMIES = 12;
/**
 * Alive minions a summoner population may hold at once, and the seconds
 * between spawns. Cut from 4 and 4.5: at those figures a summoner the player
 * had not yet reached kept the floor at its cap for the whole fight, and a
 * room with two of them read as "the floor is rushers". Three bodies every
 * six seconds is a summoner that visibly *adds* to a fight rather than one
 * that replaces it.
 */
export const SUMMONER_MINION_CAP = 3;
export const SUMMONER_INTERVAL_S = 6;
/** An enemy blocked for longer than this takes a random perpendicular nudge. */
export const BLOCKED_NUDGE_AFTER_S = 1;

/* ------------------------------- definitions ------------------------------ */

/** A periodic spawn rule. `EnemyArchetype` in ../types.ts has no field for it,
 *  so the summoner's rule lives on this module's own extension of it. */
export interface SummonRule {
  readonly archetype: EnemyId;
  readonly interval_s: number;
  /** Shared across every summoner in one encounter. */
  readonly max_alive: number;
}

export interface EnemyDef extends EnemyArchetype {
  /**
   * The archetype this is a **subspecies** of (doc 019), or absent for a base
   * body. A subspecies is a known body with one verb changed, so it keeps its
   * base's behaviour, health, reach and aggro range; `base` is what lets the
   * roster cap, the mix ratios and the renderer treat the pair as one kind.
   */
  readonly base?: EnemyId;
  /**
   * The rig part its **mark** hangs from (doc 019): a horn, a plume, a lens.
   * A subspecies is drawn as its base's frames plus this one small decal at
   * the model's `mark` anchor, and its own palette, which is 39 atlas frames
   * against the 58% a model apiece measured at.
   *
   * The drawing side of this lives in the base's rig (`rig.marks.mark`), which
   * also carries the offset; this is the same fact stated where the roster is
   * read, and `marks.test.ts` holds the two to each other so the pair cannot
   * drift into naming different parts.
   */
  readonly mark_anchor?: string;
  /**
   * Affixes that may never ride on this body (doc 019).
   *
   * One rule, stated per body: **an affix may never touch the thing the
   * subspecies changed.** A second death burst on a lancer is two rings the
   * player cannot tell apart; `burning` on a beacon is a second fire nobody
   * can see on top of the first; `shielded` on an emberling nullifies the ice
   * that is its stated answer, which doc 001 forbids outright.
   */
  readonly affix_excluded?: readonly EliteAffix[];
  readonly summon: SummonRule | null;
  /**
   * How close the player must come, with a clear line, before this enemy
   * wakes. A room where everything activates the moment the door opens has
   * one pressure level from start to finish: the player cannot engage part
   * of it, retreat and reset. Waking is per enemy, so a room becomes a set
   * of fights the player chooses the order of.
   *
   * Ranges are set against the room, which is 672 by 416 px. A stationary
   * turret needs the longest reach because it cannot follow up; a slow tank
   * gets the shortest so it never opens a fight it cannot reach.
   */
  readonly aggro_range: number;
  /**
   * Floats clear of the floor: the room's own ground — lava, a poison pool,
   * fire the player did not light — passes under it. The player's spells
   * reach it all the same, ground ones included: a spell that whiffed on a
   * third of the bestiary read as a bug, not as flight. Only what the art
   * draws off the ground flies — the shooter's winged lens, the orbiter's
   * wisp, the sower's pod.
   */
  readonly flying?: true;
  /**
   * What each element does to it, as a multiple of the damage: 1 when not
   * named, 0 immune — no damage and no status from that element. A body's
   * make decides it: a construct cannot be poisoned, a coal cannot burn.
   */
  readonly resist?: Readonly<Partial<Record<ResistElement, number>>>;
}

/** The elements a body can resist; lava is fire. */
export type ResistElement = "fire" | "ice" | "poison";

/** A body's multiple for an element's damage (`EnemyDef.resist`). */
export function resistOf(id: EnemyId, element: string): number {
  const el = element === "lava" ? "fire" : element;
  if (el !== "fire" && el !== "ice" && el !== "poison") return 1;
  return ENEMIES[id].resist?.[el] ?? 1;
}

/*
 * Health across the roster is 1.4× what it was (rusher 14 → 20, shooter 18 →
 * 25, turret 22 → 30, orbiter 20 → 28, tank 24 → 34, summoner 38 → 52; the
 * boss is sized on its own). At the old figures a sword swing of 9 killed a
 * rusher or a shooter in two and nothing outside the tank in more than three,
 * and the reference player cleared a body every 1.25 s whatever the room
 * held, so a room's length was a body count and nothing else. One more swing
 * on every body is the smallest change that makes a fight a fight; the count
 * targets in `assemble.ts` carry the rest of doc 014's room length.
 */
const RUSHER: EnemyDef = {
  id: "rusher",
  aggro_range: 260,
  behaviour: "chase",
  pattern: null,
  /**
   * Raised from 1.0, the floor of the roster, by the melee harness.
   *
   * A charge is the hardest attack for a melee player to answer, because
   * closing the distance is their own job and the charge does it for them: the
   * dodge is lateral and the window is the 190 ms the body is travelling.
   * Measured over twenty-four runs it was the largest single enemy source of
   * damage at 17%, and the reference player was still being caught 12 degrees
   * off the blade's axis, which is to say it rarely got clear at all.
   *
   * The weight is what the pressure formula spends, so being the cheapest body
   * in the roster meant the lowest-pressure rooms were built almost entirely
   * out of it — and those are exactly the rooms measuring over their band while
   * elite and peak sit inside theirs. Underpricing the cheap enemy shows up as
   * the easy rooms being too hard.
   *
   * 1.25 rather than the 1.7 the damage share alone would argue for, because
   * the band thresholds are calibrated together with the weights. The
   * canonical four-body mixed roster leaves the release band at a weight of
   * 1.285, so **this is very nearly all the headroom there is**: the weights
   * and the bands are jointly saturated, and anything larger means moving the
   * bands, which shrinks every room in the game rather than rebalancing what
   * goes in one. A 0.5-heart overshoot in a single tension band does not
   * justify that, so this takes the room that exists and no more.
   */
  threat_weight: 1.25,
  hp: 20,
  /*
   * Speeds across the roster were cut by roughly a fifth, and the tank by a
   * third, because the whole set read as agile — and agility here was never
   * raw speed (the player moves at 240) but how quickly a body could change
   * what it was doing. Lower acceleration fixed most of that; these numbers
   * are the rest of it.
   */
  speed: 92,
  radius: 10,
  /** The charge is the attack: a short blade on the front of a fast body. */
  melee: "bristle",
  ranged: null,
  tags: ["melee_heavy", "movement_pressure", "short"],
  description: "Stabs from a stride out, then drives its spikes out all round at arm's length, turn and turn about; the spacing that answers one is wrong for the other.",
  summon: null,
};

const SHOOTER: EnemyDef = {
  id: "shooter",
  // Cut from 300. A body that engages before the player can make out what it
  // is takes the choice of when to fight away from them, and for the ranged
  // archetypes that choice is most of the tactics they have.
  aggro_range: 230,
  flying: true,
  behaviour: "keep_distance",
  /**
   * Two textures and two silences. A slow fat spread you walk around, then a
   * fast thin stream you step off, with a beat between each. A single
   * uninterrupted stream is the flattest thing a shooter can do: nothing to
   * read, and no moment when the player is allowed to reposition.
   *
   * **Thinned and slowed for melee**, which doc 013 names as necessary and
   * which the harness then measured: at the previous rates this one archetype
   * was 28% of every heart lost in the game, three times the next bullet
   * source and more than any enemy's blade. The mechanism is specific to it.
   * It keeps its distance, so it retreats from an approaching player while
   * firing **aimed** shots — nine of them per five-second cycle — and the
   * player closing the gap is moving at a third to two thirds of their speed
   * whenever they swing. Aimed fire at that density is not dodged, it is
   * absorbed.
   *
   * So the cycle goes from about nine bullets to five, the volleys become one
   * each rather than two or three, and both speeds drop. What is kept is the
   * shape: a fat spread, a silence, a thin stream, a silence. This is the
   * Octorok's grammar rather than a shmup's — discrete, slow, readable, widely
   * spaced — because the answer has to be *closing*, and a player cannot close
   * through something they can only memorise.
   */
  /**
   * **No spread, ever.** A fan is how a shooter closes a lane, and closing
   * lanes is the one thing a melee game cannot afford: the player's whole job
   * is to arrive, and three bullets across thirty degrees means the ground
   * they were going to arrive through is gone. Together with bullets being as
   * wide as the player was, it made crossing a room a matter of luck.
   *
   * What is left is one aimed shot at a time, slow, with silences long enough
   * to travel in — a rhythm of *one thing to read* rather than a shape to
   * memorise. This is the Octorok's grammar, and it is the grammar because it
   * is the one that lets a player with a sword walk toward you.
   */
  /*
   * The silences are shorter than they were — 2.4 and 2.6 seconds became 1.3
   * and 1.4, and each firing window holds one more shot. The grammar above is
   * unchanged and is the reason this is safe: it is still one aimed bullet at
   * a time, slow, with a gap to travel in. What was wrong was the *amount* of
   * nothing. At an eight-second cycle carrying three or four bullets, a
   * shooter the player had decided to ignore was genuinely ignorable, and a
   * room of them was a room of statues.
   */
  /*
   * **The silences are longer again, and the burst is a pair.**
   *
   * The cycle above was set when the shooter was measured at 9% of every
   * heart lost in the game — a figure taken while two bugs were silencing it
   * (see `threat_weight`). Delivering the cadence it was actually written for,
   * it is the largest source of damage in the game at 28%, which is the
   * condition this archetype's whole pattern note exists to prevent.
   *
   * Nothing about the *shape* changes, because the shape is right: one aimed
   * bullet at a time, slow, with a gap to travel in. What changes is the
   * amount of it — a cycle of 11.1 s carrying four bullets rather than 9.2 s
   * carrying five, which is about a third less fire from the same body. The
   * silences went out by another 0.3 s each in the second pass, which is what
   * took it from a quarter of the damage in the game to a fifth.
   */
  pattern: sequence([
    { pattern: single({ speed: 165, aim: "player", interval: 1.0, size: 1 }), duration: 1.6 },
    { pattern: rest(), duration: 2.6 },
    { pattern: single({ speed: 260, aim: "player", interval: 1.0, size: 0.8 }), duration: 1.6 },
    { pattern: rest(), duration: 2.7 },
    // The second move: a two-shot burst, small and quick, down one aimed
    // line. Still one lane to step off — but a lane that has to be stepped
    // off *now*, where the single shots could be walked around.
    { pattern: single({ speed: 240, aim: "player", interval: 0.22, size: 0.7 }), duration: 0.44 },
    { pattern: rest(), duration: 3.1 },
  ]),
  /*
   * 2.2, from 1.5, in the joint recalibration (doc 011).
   *
   * The old figure was measured while two bugs were silencing this body: a
   * `keep_distance` body that reached point-blank range could never give
   * ground again, so it sat inside the silence radius doing nothing for the
   * rest of a fight — and a player closing on a shooter is most of what this
   * game is. Firing the cadence doc 005 describes it went from 9% of every
   * heart lost to 25%, three times the next bullet source, which is the exact
   * failure the note on its pattern is about.
   *
   * The pattern is what the doc says it is; what was wrong was the **price**,
   * so this is one of the two numbers that moved — the weight, so a room buys
   * fewer shooters, and the silences in the pattern, so each one fires less.
   *
   * 2.2 and not higher: at 2.6 the `ranged_heavy` mixes measure past the band
   * ceilings and thirty-five assemblies fall out of band. The weights and the
   * bands are calibrated against each other, so the rest of the correction
   * has to come from the cadence.
   */
  threat_weight: 2.2,
  hp: 25,
  speed: 68,
  radius: 9,
  melee: null,
  ranged: null,
  tags: ["ranged_heavy", "ranged_pressure", "mid"],
  description: "Holds mid range and places a single aimed shot; baseline ranged pressure.",
  summon: null,
};

const TURRET: EnemyDef = {
  id: "turret",
  // Cut from 360, which was most of the room's width: it opened on the player
  // from across the arena, before they had a route or a reason.
  aggro_range: 250,
  resist: { poison: 0 },
  behaviour: "stationary",
  /**
   * **Lightning, not bullets.** The rotating ring it used to fire was the most
   * hostile thing in the game to a melee player, and for a structural reason:
   * a ring denies every direction at once, so there is no approach to find. A
   * player whose only way to deal damage is to arrive cannot arrive through
   * it, and the harness bore that out — every unclearable room in the melee
   * build had a turret left standing in it.
   *
   * A strike marker denies the same thing the ring denied — **ground** — while
   * leaving an approach, because it says exactly which ground and for how
   * long. That is a better fit for "never moves and denies the area around
   * it" than the ring ever was: the ring made the turret unapproachable, and
   * area denial is supposed to make a place expensive, not impossible.
   *
   * It also gives the roster an attack that nothing else has. A projectile can
   * only invalidate standing in its path; this invalidates *standing*, it is
   * the only attack that moves a player who has nothing near them, and cover
   * is no answer to it because it falls from above.
   */
  pattern: null,
  /*
   * Every four and a half seconds, not every two and a half.
   *
   * At 2.6 s a single turret lands about eleven strikes in a thirty-second
   * room, and each one scars the floor. The marks stacked three and four deep
   * and the arena read as stained rather than as fought over — and a strike
   * that arrives constantly is also not an event, it is weather. The telegraph
   * alone is 900 ms, so this leaves about three and a half seconds of quiet
   * between one strike resolving and the next being called.
   */
  // Every five seconds rather than six: the telegraph is 900 ms, so this still
  // leaves nearly three seconds of quiet between one strike resolving and the
  // next being called, and the turret is threatening for more of a fight than
  // it is idle. 4.5 was a beat too tight once several were in a room together.
  ranged: { kind: "lightning", interval_s: 5.2 },
  threat_weight: 2.0,
  /*
   * Cut from 28. It is stationary area denial — its job is to make a place
   * expensive, not to be a wall — and four swings to remove something that
   * cannot chase or dodge is four swings of standing in its strike zone.
   */
  hp: 30,
  speed: 0,
  radius: 12,
  melee: null,
  tags: ["area_denial", "ranged_pressure", "long"],
  description: "Never moves and calls lightning down on the ground you are standing on; denies places, not directions.",
  summon: null,
};

/**
 * The two variants. Both exist because six archetypes was a short roster to
 * read forty rooms against: the lancer is a second melee body whose commit
 * is from **range**, so the rusher's answer (step in) is wrong for it; the
 * sentinel is a second emplacement whose threat is a **bullet**, so the
 * turret's answer (step off the marked ground) is wrong for it. Each is a
 * known body with one rule changed, which is what makes it learnable.
 */
const LANCER: EnemyDef = {
  id: "lancer",
  // Its own death already bursts spikes; a second ring is two rings the
  // player cannot tell apart.
  affix_excluded: ["volatile"],
  // The rusher's subspecies, and the one that predates doc 019's block: the
  // same spikes, driven from half a tile further out and then let go.
  base: "rusher",
  aggro_range: 250,
  behaviour: "chase",
  pattern: null,
  ranged: null,
  melee: "lance",
  threat_weight: 1.6,
  hp: 18,
  // Quick: it walks up to you, the fastest body allowed (doc 005 holds the
  // fastest at under 0.88 of the player). The threat is the walk, not a charge.
  speed: 104,
  radius: 8,
  tags: ["melee_heavy", "movement_pressure", "mid"],
  description: "The rusher's spikes, longer: the same all-round drive from a tile and a half out, so the pace the rusher can be kept at is inside its reach. The elite bursts eight spikes across the room when it dies.",
  summon: null,
};

const SENTINEL: EnemyDef = {
  id: "sentinel",
  aggro_range: 250,
  resist: { poison: 0 },
  behaviour: "stationary",
  pattern: sequence([
    { pattern: single({ speed: 150, aim: "player", interval: 1.3, size: 1.2 }), duration: 1.3 },
    { pattern: rest(), duration: 1.5 },
  ]),
  ranged: null,
  melee: null,
  threat_weight: 1.7,
  hp: 26,
  speed: 0,
  radius: 11,
  tags: ["ranged_heavy", "ranged_pressure", "area_denial", "long"],
  description: "A fixed emplacement that aims one slow, fat shot at a time; a lane to step out of rather than ground to leave.",
  summon: null,
};

/*
 * The expansion (research: `docs/research/enemy-expansion.md` §2). Each body
 * is one new question for the player, and each elite asks it differently —
 * the elite forms are attacks, not multipliers (`attacks.ts`).
 *
 * Health is on the roster's scale (the rusher is 20, the tank 34). Threat
 * weights are the research's estimates until the harness calibrates them.
 */

/** A walking door: its plate turns direct hits from the front, so the answer is position. */
const WARDEN: EnemyDef = {
  id: "warden",
  aggro_range: 230,
  resist: { poison: 0.5 },
  // Its arm is a gun (the delivered sheet drew it so): a heavy body that holds
  // a middle distance and fires a blunderbuss. See `fireMusket`.
  behaviour: "keep_distance",
  pattern: null,
  // A room-sized threat at 3.2 s and a wider, longer gout, measured by eye:
  // it pressed like a boss. A heavy body's shot should be an event.
  ranged: { kind: "musket", interval_s: 4.2 },
  /**
   * The plate is a weapon too. A heavy gunner's problem is somebody standing
   * on it while it reloads, and its answer was nothing at all — so at contact
   * range it shoves with the shield, which does little damage and a great
   * deal of knockback: it makes room rather than trading. See `bash`.
   */
  melee: "bash",
  threat_weight: 2.6,
  hp: 40,
  speed: 46,
  radius: 13,
  tags: ["ranged_heavy", "ranged_pressure", "mid"],
  description: "Heavy armour and a blunderbuss for an arm: it raises the gun, levels it and fires a wide spray that carries a few tiles, then stands to reload. Be out of reach, or on it while it reloads. The elite fires twice.",
  summon: null,
};

/** A support that never swings: it arms an ally with a tether that the player cuts by standing in it. */
const BELLRINGER: EnemyDef = {
  id: "bellringer",
  aggro_range: 240,
  behaviour: "keep_distance",
  pattern: null,
  ranged: { kind: "ward", interval_s: 1.5 },
  melee: null,
  threat_weight: 2.0,
  hp: 16,
  speed: 62,
  radius: 9,
  tags: ["ranged_heavy", "ranged_pressure", "long"],
  description: "Armours an ally down a tether. Its toll refills every shield it holds at once and hurries nearby bodies; it does no damage, and a hit during the windup stops it. Cut the line, or interrupt. The elite peals.",
  summon: null,
};

/** A half-buried totem that splits the floor along a line: it denies a route, not a spot. */
const RIFTER: EnemyDef = {
  id: "rifter",
  aggro_range: 250,
  behaviour: "stationary",
  pattern: null,
  ranged: { kind: "rift", interval_s: 3.4 },
  melee: null,
  threat_weight: 1.9,
  hp: 24,
  speed: 0,
  radius: 11,
  tags: ["ranged_heavy", "area_denial", "long"],
  description: "Never moves; cracks the floor in a line toward you, and every third time in a cross. Step across the line, not away. The elite walks its cracks toward you one after another.",
  summon: null,
};

/** A chain on a long arm: it moves the player, into other bodies' reach. */
const SNARECASTER: EnemyDef = {
  id: "snarecaster",
  aggro_range: 240,
  behaviour: "keep_distance",
  pattern: null,
  ranged: { kind: "hook", interval_s: 4.2 },
  melee: null,
  threat_weight: 2.2,
  hp: 22,
  speed: 66,
  radius: 9,
  tags: ["ranged_heavy", "movement_pressure", "mid"],
  description: "Lays its chain along the line it will throw, drags you in on a hit, then lashes the ground round its own feet as you land. Dash across the line, or break it with a pillar. The elite anchors the chain instead.",
  summon: null,
};

/** Treats the floor as a door: it dives, travels as a mound and comes up under you. */
const DELVER: EnemyDef = {
  id: "delver",
  aggro_range: 230,
  behaviour: "chase",
  pattern: null,
  ranged: null,
  melee: "bristle",
  threat_weight: 1.7,
  hp: 24,
  speed: 80,
  radius: 9,
  tags: ["melee_heavy", "movement_pressure", "short"],
  description: "Stabs and drives by turns on the surface for a few seconds, then dives and travels as a mound you can see; where the mound stops, it erupts. Lead it into fire. The elite erupts three times along its line.",
  summon: null,
};

/** A walking coal that is delighted to be set on fire. */
const CINDERLING: EnemyDef = {
  id: "cinderling",
  // Fire is what it eats and ice is its stated answer (doc 001: no nullification).
  affix_excluded: ["burning", "shielded"],
  aggro_range: 220,
  resist: { fire: 0, ice: 1.5 },
  behaviour: "chase",
  pattern: null,
  ranged: { kind: "lob", interval_s: 3.8 },
  melee: null,
  threat_weight: 1.8,
  hp: 26,
  speed: 70,
  radius: 9,
  tags: ["melee_heavy", "area_denial", "mid"],
  description: "Lobs coals that burn where they land. Fire heals it and speeds it up, and while it burns it leaves a burning trail — ice and the sword are the answer. The elite, set alight, flares into a ring of fire.",
  summon: null,
};

/** A drifting pod that plants seeds which arm after the window a dash covers. */
const SOWER: EnemyDef = {
  id: "sower",
  // It sheds its seeds on death already.
  affix_excluded: ["volatile"],
  aggro_range: 230,
  flying: true,
  resist: { fire: 1.5, poison: 0.5 },
  behaviour: "orbit",
  pattern: null,
  /*
   * A seed every three seconds, not every 2.2. The sower plants under its own
   * feet, so unlike the shooters it was never silenced by the two bugs the
   * recalibration is about — but it inherited their share once they stopped
   * being most of the damage, and at 12% of every heart lost from a body that
   * asks only that the player not walk into it, it was over its price.
   */
  ranged: { kind: "mine", interval_s: 3.0 },
  melee: null,
  threat_weight: 2.0,
  hp: 20,
  speed: 58,
  radius: 9,
  tags: ["ranged_heavy", "area_denial", "long"],
  description: "Drifts round you dropping seeds that arm a moment later and burst when you come near. The sword and fire set them off. On death it sheds its seeds. The elite plants a ring of them round you, with two gaps.",
  summon: null,
};

const ORBITER: EnemyDef = {
  id: "orbiter",
  aggro_range: 220,
  flying: true,
  behaviour: "orbit",
  /**
   * It circles, so its pressure should reward circling with it. The spiral
   * gives a direction to run; the gapped aimed fan punishes standing still
   * once you have found it.
   */
  /**
   * **The spiral is gone.** A spiral's purpose is to fill a room, which is the
   * one thing a melee game cannot afford: the player's job is to arrive, and
   * a pattern with no gaps has nothing to arrive through. It was about
   * eighteen bullets a cycle, the densest emitter left in the roster.
   *
   * What is left is a single aimed shot from wherever it has circled to, with
   * long silences. That keeps the whole point of the archetype — pressure from
   * the flank, so standing still is punished and turning to face it is the
   * answer — while a player crossing the floor only has to read one bullet at
   * a time. The paired shot is there so a player who has cut the corner does
   * not get it entirely for free.
   */
  /*
   * Longer silences, for the reason the shooter's are: an orbiter that is
   * actually circling and firing is 18% of every heart lost against the 5% it
   * was measured at. The shape — one aimed shot from wherever the circle has
   * taken it, and a quick pair as its second move — is unchanged.
   */
  pattern: sequence([
    { pattern: single({ speed: 200, aim: "player", interval: 0.95, size: 0.9 }), duration: 1.3 },
    { pattern: rest(), duration: 1.7 },
    { pattern: single({ speed: 175, aim: "player", interval: 1.15, size: 0.9 }), duration: 1.5 },
    { pattern: rest(), duration: 1.8 },
    // The second move: a quick pair from wherever the circle has taken it.
    { pattern: single({ speed: 230, aim: "player", interval: 0.25, size: 0.8 }), duration: 0.5 },
    { pattern: rest(), duration: 2.0 },
  ]),
  /*
   * 2.6, from 2.0, for the same reason the shooter moved: the orbiter counted
   * as "stuck" its whole life, because the jam test asks whether a body is
   * getting nearer the player and a body holding a radius never is — so it
   * abandoned its circle, walked in and parked inside the silence radius.
   * Circling and firing it is 19% of every heart lost rather than 5%.
   */
  threat_weight: 2.6,
  hp: 28,
  speed: 84,
  radius: 9,
  melee: null,
  ranged: null,
  tags: ["ranged_pressure", "movement_pressure", "mid"],
  description: "Circles you at a fixed radius and fans shots inward; pressure from the flank.",
  summon: null,
};

const TANK: EnemyDef = {
  id: "tank",
  aggro_range: 210,
  resist: { poison: 0.5 },
  behaviour: "chase",
  /**
   * **No bullets at all.** It had a six-then-four shot shotgun on top of a
   * melee attack, and a body that both closes on you and punishes you for
   * being closed on has no answer: an enemy that covers two ranges is two
   * enemies wearing one sprite, and for a melee player the one at range is the
   * one they cannot do anything about.
   *
   * Dropping it also thins the room. With the turret on lightning and the
   * summoner on thrown flame, the roster now has exactly one archetype whose
   * threat is a stream of projectiles, which is what makes arriving possible.
   */
  pattern: null,
  ranged: null,
  // Raised from 3.0 by the play harness: the highest health pool in the
  // roster is the longest exposure, which presence alone does not capture.
  threat_weight: 5.0,
  /**
   * Cut from 60, and the contact damage from 2, because the melee turn made
   * this one enemy a third of all the damage in the game.
   *
   * Measured over twelve reference runs, `contact:tank` alone accounted for
   * 33% of every heart lost — more than every bullet in the game combined.
   * At 60 HP it took about seven connecting swings, and at 2 damage a lunge
   * three lunges emptied a six-heart bar, so a melee player had to stand in
   * front of it for several seconds at an exchange rate that could not be won.
   *
   * 42 is about five swings, which is where the genre sits: Nuclear Throne's
   * rule of thumb is that almost everything dies in one to five hits. It is
   * still by far the longest fight in the roster, which is what "hard to kill"
   * should mean.
   */
  /*
   * 24 health behind 18 armour, so it is still the 42 points it was — the
   * armour is carved out of the health rather than added to it. What changed
   * is what the first 18 of them buy: the right to interrupt it. See
   * `Enemy.armour`.
   */
  hp: 34,
  /*
   * 34, down from 52. Its sprite is the bulkiest in the roster and it was
   * moving at two thirds the speed of a jellyfish, which is the mismatch
   * behind "the tank and its art do not go together". A body that size should
   * plod, and the charge is where its speed lives — at 5.5x the commit it
   * still crosses five tiles.
   */
  speed: 34,
  /*
   * 14, down from 16.
   *
   * At 16 its diameter was 32 px — **exactly one tile** — so it could not fit
   * through a one-tile gap at all: the four collision probes touch both walls
   * at once and every frame is a blocked frame. The generator makes one-tile
   * passages, so the largest body in the roster was simply unable to use part
   * of the map, and it ground on the corners of anything it tried to squeeze
   * through.
   *
   * 28 px leaves two pixels of clearance a side. It is still the biggest thing
   * in the game by a wide margin, and "the heavy one cannot follow you down a
   * corridor" is not a characterisation worth keeping — it reads as the
   * pathfinding being broken, which is how it was reported.
   */
  radius: 14,
  /**
   * A greatsword, not a ram. See `cleave` in `MELEE_ATTACKS`: the roster
   * already has two bodies that close the gap with a blade, and a third made
   * the tank a slow one of them. Its slam (`whirlwind`) is chosen instead
   * when the player is on top of it or behind it — see `chooseMelee`.
   */
  melee: "charge",
  tags: ["melee_heavy", "movement_pressure", "short"],
  description: "Slow, armoured and unstoppable once it commits; charges you down, and knocks itself out on a wall.",
  summon: null,
};

const SUMMONER: EnemyDef = {
  id: "summoner",
  // A body that makes bodies must not also make bodies when it dies: the kill
  // order is the whole question it asks.
  affix_excluded: ["splitting"],
  aggro_range: 260,
  resist: { fire: 0.5 },
  behaviour: "keep_distance",
  /**
   * **Thrown flame, not a ring.** Its ring had the same defect as the
   * turret's, with less excuse: a body whose job is to say "come and deal with
   * me" was denying every direction of approach to the player coming to deal
   * with it.
   *
   * Burning ground is the right threat for it because it is the only attack
   * that **changes the terrain**. A strike punishes an instant and is gone, so
   * the player steps out and steps back; a fire takes floor out of play while
   * it burns, which shrinks the arena and shapes the route in. That is the one
   * thing that makes a room's layout matter to a melee fight, and it is what
   * a summoner should be doing while its minions arrive.
   *
   * It burns the minions too, which is the point rather than an oversight:
   * a hazard that only hurts the player is a tax, and one that hurts
   * everything is a tool.
   */
  pattern: null,
  /*
   * Rare, and rarer than the summoning.
   *
   * This body carries the roster's only terrain change **and** its only
   * reinforcements, and at a 3.6 s flame plus a 3 s summon it was doing both
   * at once for the whole fight — two threats from one sprite, which is the
   * defect the note on the tank's shotgun names. The flame is not moved to
   * another archetype because there is nowhere for it to go that does not
   * reintroduce the same fault: the turret, the shooter and the orbiter each
   * already own a ranged threat, and the rusher and tank are chasers, for whom
   * a ranged attack is exactly what that note forbids.
   *
   * So it stays here and becomes an **event**: about one patch per seven
   * seconds, which over a fifteen-second fight is two, against a summoner
   * whose main business is visibly the minions.
   */
  ranged: { kind: "flame", interval_s: 7 },
  // Raised from 3.0: a summoner that outlives the player's dps keeps
  // producing, so its cost is not one body but the room not ending.
  threat_weight: 4.5,
  hp: 52,
  speed: 56,
  radius: 11,
  melee: null,
  tags: ["area_denial", "movement_pressure", "long"],
  description: "Keeps far away and throws fire that burns on the ground; feeds rushers into the room until it dies.",
  summon: { archetype: "rusher", interval_s: SUMMONER_INTERVAL_S, max_alive: SUMMONER_MINION_CAP },
};


/**
 * The boss: one body, three phases, and the only fight that ends a run.
 *
 * It is an `EnemyId` like the rest rather than a scripted set-piece, and that
 * is the whole design. Everything the roster already has — perception lag, the
 * glance, attack tokens, stagger, armour, the melee cycle, the ranged
 * telegraph — applies to it for free, so it is a fight the player already
 * knows how to read. A bespoke boss with its own state machine would be a
 * second combat system to balance, and doc 001's charter is against exactly
 * that kind of second system.
 *
 * **The three phases are health thresholds, not modes.** At two thirds and one
 * third of its health it changes what it does, which is what the three drawn
 * frames say. Phases as thresholds rather than as timers means the player's
 * damage is what advances the fight, so a better build sees the later phases
 * sooner — the opposite of a timed boss, where a better build only waits less.
 *
 * Numbers chosen against the roster rather than invented. Its health is about
 * four tanks; its armour is a tank's, so the player's first job is the same
 * one they have practised all run; and it moves at a shooter's pace, because a
 * boss that can be outrun is a boss the whole fight is spent outrunning.
 */
const BOSS: EnemyDef = {
  id: "boss",
  aggro_range: 900,
  behaviour: "chase",
  /*
   * The three drawn phases are one **sequence**, the same primitive the
   * shooter and the orbiter use, rather than a new phase system keyed to
   * health.
   *
   * Health thresholds were the first design and they are worse here for a
   * reason worth keeping: a boss that changes at two thirds health is a boss
   * whose fight the player sees a different amount of depending on their
   * damage, so the one encounter the whole run builds toward is the one they
   * are least likely to see all of. A cycle shows every phase to everybody,
   * and a player who kills it fast is rewarded by fighting it for less time
   * rather than by skipping the part that was drawn.
   *
   * The rests between are not padding. They are when a melee player closes,
   * and without them the arena is never safe to cross.
   */
  pattern: sequence([
    // Aimed and slow: the tell the later stages reuse.
    { pattern: single({ speed: 200, aim: "player", interval: 1.1, size: 1.2 }), duration: 2.4 },
    { pattern: rest(), duration: 1.2 },
    // A spread, so standing directly in front stops being the answer.
    { pattern: fan({ speed: 215, count: 3, spread_deg: 34, aim: "player", interval: 1.6, size: 1 }), duration: 2.6 },
    { pattern: rest(), duration: 1.0 },
    // A ring: nowhere is safe, only the gaps are, and it has to be crossed.
    { pattern: ring({ speed: 175, count: 10, interval: 2.4, rotate_deg: 18, size: 0.9 }), duration: 2.4 },
    // Rests shortened by a third across the cycle: at the old lengths the
    // boss took less than half a heart off the reference player over a whole
    // fight, and a rest is the window the sword gets, not a pause in the fight.
    { pattern: rest(), duration: 1.4 },
  ]),
  threat_weight: 20,
  /*
   * 2200, by way of 720, from 96. Doc 003 budgets the boss at two to three
   * minutes. 96 was measured at 2.6 seconds and 720 at 25: the reference
   * player lands about 29 damage a second on this body across the whole fight,
   * pattern reading included, so this figure is a fight of about seventy-five
   * seconds for the model. The model is faster than a person — it does not
   * miss, and it reads a telegraph in 230 ms — so seventy-five model seconds
   * is the two to three minutes the budget names. See doc 011 on the factor.
   */
  /*
   * 1250, from 2200. At 2200 the sword needed about 240 connecting swings and
   * a measured fight ran well over a minute of standing and hitting: the
   * boss was a wall of health with a few attacks, which is the first failure
   * the enemy-design survey names. The pressure now comes from its moves
   * (slam, leap, adds, three phases of pattern) and the armour that returns
   * each phase, not from how long it takes to wear down.
   */
  /*
   * 1900, from 1250. **The boss gated on skill, not on the build.** Measured
   * over twelve runs each: the expert profile beat it 12 out of 12 in 32
   * seconds for 1.7 hearts, and the average profile lost 11 out of 11 with
   * the *same* build — 11.7 spell levels and 6 affixes either way. A fight
   * the strong player walks through and the weak one cannot touch is a
   * reaction test, and what the run is supposed to have been building toward
   * is a build.
   *
   * Health is the lever that makes it one, because health is what a build
   * converts into time. At 1900 a bare staff — one unlevelled key at about
   * 11 dps — needs nearly three minutes and loses on the clock; a formed
   * build at fifty or sixty puts it down in half of one. The player's skill
   * still decides what it costs them; the build decides whether it is
   * possible at all.
   */
  /*
   * 3750. **Health is what a build turns into time**, and the fight is now
   * spent mostly getting out of the way: each of his blows costs a tenth of
   * the bar and is read, dodged and then punished, so the player's damage
   * comes in the openings rather than all the time. At 6000 that made the
   * fight far too long to hold attention; at 3000, once he took his turns
   * one at a time and rested between them, it was over too soon to see his
   * moves (playtest 2026-09-25): a quarter more (doc 020).
   */
  hp: 3750,
  speed: 62,
  radius: 22,
  /** It swings. The arc is wide, which is what its size is for. */
  melee: "slash",
  /** It shoots rather than using a non-projectile special. */
  ranged: null,
  /*
   * Tags describe **how a body fights**, not what it is. "boss" would be both
   * redundant with the id and outside doc 010's closed vocabulary, which is
   * closed on purpose: Jev reads these, and a vocabulary that grows per
   * content entry stops being a vocabulary.
   *
   * All three of these are true of it at once, which is the characterisation:
   * it walks you down, it denies ground with its patterns, and it hits hard in
   * melee when it arrives.
   */
  tags: ["melee_heavy", "movement_pressure", "area_denial"],
  description:
    "The floor's master. Its arms sweep a circle while it walks and shoots; it slams "
    + "broken floor out in rings, splits the ground, leaps, and backhands anyone who "
    + "stays in its reach. Three phases, armoured again at each.",
  summon: null,
};

/**
 * The boss's three authored phases: doc 005's "three authored preset phases",
 * the fixed content that `planBoss`'s generated phases are measured against
 * and that ships when no plan exists. Thresholds at 100%, 60% and 30% of
 * health, as the doc sets them. Each phase is **faster and wider than the
 * last** in the same moves — the pattern grows from an aimed shot to a
 * spiral, the body from a slow walker to one that rams — so the fight is one
 * body learned three times rather than three bodies.
 *
 * `rate` scales the pattern clock and `speed` the walk; `melee` is which
 * blade the phase reaches for, by distance (see `chooseMelee`).
 */
export interface BossPhase {
  /** The health fraction at or below which this phase begins. */
  readonly at: number;
  readonly name: string;
  readonly pattern: PatternNode;
  readonly rate: number;
  readonly speed: number;
  /**
   * The blade used when far (`charge` only beyond `farPx`), and when the
   * player is on top of it or behind it. Between the two the king alternates
   * the greatsweep and the greatcleave (`chooseMelee`).
   */
  readonly melee: { readonly far: MeleeKind; readonly near: MeleeKind };
  /**
   * **The strings** (doc 020): the blows that follow an opening blow in this
   * phase, each laid on the music — `at` is when it lands, in eighth notes of
   * the boss theme after the opening blow landed. The light cuts come close
   * and the heavy one waits: `x--x----X` is two slashes a beat and a half
   * apart and the cleave on the next downbeat, and a player who panics and
   * dashes the second slash has spent the dash the cleave was for. Only the
   * last blow recovers, and its recovery is the punish window. Phase I has
   * only the dashcut's: one thing at a time. A cut that follows a cut comes back the other way.
   */
  readonly strings: Partial<Record<MeleeKind, readonly BossBlow[]>>;
  /** How far "far" is, in px. */
  readonly farPx: number;
}

/** One blow of a boss string: what, and when it lands (`BossPhase.strings`). */
export interface BossBlow {
  readonly kind: MeleeKind;
  /** Eighth notes of the boss theme after the string's opening blow lands. */
  readonly at: number;
}

export const BOSS_PHASES: readonly BossPhase[] = [
  {
    at: 1, name: "I",
    /*
     * **Phase I teaches the three shapes the rest of the fight is built
     * from**, one at a time, with a rest between each: the aimed shot (step
     * off the line), the fan (the gaps between the shots are the lanes) and
     * the holed ring (the hole rotates, so the lane is a place you walk to).
     * Nothing here is layered — a player meeting the boss for the first time
     * is answering one question at a time on purpose.
     */
    pattern: sequence([
      // Aimed and slow: the tell the later phases reuse.
      { pattern: single({ speed: 164, aim: "player", interval: 1.0, size: 1.2 }), duration: 2.2 },
      { pattern: rest(), duration: 1.0 },
      // A spread, so standing directly in front stops being the answer.
      { pattern: fan({ speed: 172, count: 3, spread_deg: 34, aim: "player", interval: 1.4, size: 1 }), duration: 2.4 },
      { pattern: rest(), duration: 1.0 },
      /*
       * **A wall with a hole in it.** The ring's gap sits opposite its own
       * rotation offset, so it sweeps a quarter-turn per volley: the lane is
       * never where it was, and the answer is to walk to meet it. This is the
       * shape phases II and III tighten rather than replace.
       */
      { pattern: ring({ speed: 134, count: 8, interval: 2.0, rotate_deg: 24, gap_deg: 46, size: 0.95 }), duration: 2.0 },
      { pattern: rest(), duration: 1.0 },
    ]),
    rate: 0.85, speed: 1.05, melee: { far: "greatslash", near: "greatsweep" }, farPx: 999,
    // One thing at a time, and the dashcut is one thing: the run and the cut it carries him into.
    strings: { dashcut: [{ kind: "greatslash", at: 6 }] },
  },
  {
    at: 0.6, name: "II",
    /*
     * **Phase II layers.** Every step but the rests now asks two questions
     * whose answers disagree: the holed ring wants the player walking round
     * the arena to meet its lane, and the aimed shot inside it wants them
     * stepping off a line that is redrawn every 1.4 s. The spiral that closes
     * the cycle is the first pattern that decides which way they run.
     */
    pattern: sequence([
      {
        pattern: parallel([
          ring({ speed: 141, count: 9, interval: 1.7, rotate_deg: 26, gap_deg: 42, size: 0.95 }),
          single({ speed: 204, aim: "player", interval: 1.7, size: 1.1 }),
        ]),
        duration: 3.0,
      },
      { pattern: rest(), duration: 0.9 },
      { pattern: fan({ speed: 178, count: 3, spread_deg: 48, aim: "player", interval: 1.1, size: 1 }), duration: 2.2 },
      { pattern: rest(), duration: 0.8 },
      /*
       * **Rotating spokes.** Two arms turning one way: every lane between
       * them closes from the same side, so a player standing still is caught
       * and a player running *with* the turn stays in the same lane for as
       * long as they keep moving. It is the bullet version of the lash, and
       * the two are deliberately the same lesson at two ranges.
       */
      { pattern: spiral({ arms: 2, angular_speed: 94, speed: 141, interval: 0.45, size: 0.85 }), duration: 2.4 },
      { pattern: rest(), duration: 0.8 },
    ]),
    rate: 1, speed: 1.15, melee: { far: "dashcut", near: "greatsweep" }, farPx: 120,
    strings: {
      // x--x----X
      // The greatcleave is out of his hand (it read strangely); the sweep closes the strings in its place.
      greatslash: [{ kind: "greatslash", at: 3 }, { kind: "greatsweep", at: 8 }],
      greatsweep: [{ kind: "greatslash", at: 6 }],
      dashcut: [{ kind: "greatsweep", at: 6 }],
    },
  },
  {
    at: 0.3, name: "III",
    /*
     * **Phase III crosses the layers over.** The counter-rotating spirals are
     * the one pattern in the game with no standing answer at all: the two
     * sets of lanes scissor, so the safe ground is a moving intersection and
     * the player is walking a figure the fight draws for them. Then the ring
     * comes back with a narrower hole and a slower sweep — the same question
     * as phase I, asked at a pace that no longer forgives being late — and
     * the cycle ends on the aimed pair, which is what punishes a player who
     * has stopped watching the body while reading the floor.
     */
    pattern: sequence([
      {
        pattern: parallel([
          spiral({ arms: 3, angular_speed: 83, speed: 142, interval: 0.6, size: 0.85 }),
          spiral({ arms: 3, angular_speed: -86, speed: 117, interval: 0.8, size: 0.85 }),
        ]),
        duration: 3.0,
      },
      { pattern: rest(), duration: 0.7 },
      { pattern: ring({ speed: 154, count: 10, interval: 1.5, rotate_deg: 13, gap_deg: 36, size: 0.9 }), duration: 2.6 },
      { pattern: rest(), duration: 0.6 },
      {
        pattern: parallel([
          fan({ speed: 189, count: 4, spread_deg: 62, aim: "player", interval: 1.0, size: 1 }),
          single({ speed: 228, aim: "player", interval: 1.0, size: 1.15 }),
        ]),
        duration: 2.0,
      },
      { pattern: rest(), duration: 0.7 },
    ]),
    rate: 1.1, speed: 1.3, melee: { far: "dashcut", near: "greatsweep" }, farPx: 110,
    strings: {
      // x--x--x-----X: three slashes, and the sweep held a beat longer than phase II's.
      greatslash: [{ kind: "greatslash", at: 3 }, { kind: "greatslash", at: 6 }, { kind: "greatsweep", at: 12 }],
      greatsweep: [{ kind: "greatslash", at: 4 }, { kind: "greatsweep", at: 10 }],
      dashcut: [{ kind: "greatslash", at: 5 }, { kind: "greatsweep", at: 10 }],
    },
  },
];

/*
 * **The king is met twice** (doc 022). In room 5 he drops into an ordinary
 * fight and plays phase I only (`"audience"`): at `KING_RETREAT_AT` of that bar
 * the armour breaks, as it always has at 60%, and he goes back up out of the
 * room rather than calling his adds. In the throne hall he stands already in
 * phase II (`"final"`), without the armour the player broke, and phases II and
 * III share a larger bar. A body with no script is the one fight he was before:
 * the bench, the lab and every test that predates the document.
 */
export type BossScript = "audience" | "final";

/**
 * The first audience's bar. Phase I is spent down to `KING_RETREAT_AT` of it,
 * so the fight is 40% of this, sized for a room-5 build — one or two spells, a
 * level or two. Measured (`boss-bench 8 typical all audience`): at 1250 the
 * fight was 17 to 22 s for the `player` and `average` profiles; at 2000 it is
 * 26 and 33 s, and a `novice` survives it a quarter of the time on the bar
 * alone, before the three spare hearts (doc 022, "Measured before it ships").
 * 2500 reached 32 and 41 s and no novice lived: the length doc 022 asks for
 * and the survival room 5 was moved for pull against each other here.
 */
export const KING_AUDIENCE_HP = 2000;
/** Where the first audience ends: phase II's threshold, where the armour breaks. */
export const KING_RETREAT_AT = 0.6;
/**
 * The final fight's bar: phases II and III, which were 60% of 3750 (2250), over
 * twice that. Phase I has moved to room 5, so the denser phases alone hold doc
 * 020's two minutes, against a player who has seen him once already.
 */
export const KING_FINAL_HP = 4500;
/** Where phase III begins in the final fight: the bar shared evenly by II and III. */
export const KING_FINAL_III_AT = 0.5;

/** The king's bar under a script. */
export function kingHp(script?: BossScript): number {
  return script === "audience" ? KING_AUDIENCE_HP : script === "final" ? KING_FINAL_HP : ENEMIES.boss.hp;
}

/**
 * The marks on his health bar: where each change in the fight falls. The
 * final's phase III at the half; the first audience's one mark, where he
 * leaves; the whole fight's two.
 */
export function kingMarks(script?: BossScript): readonly number[] {
  if (script === "final") return [KING_FINAL_III_AT];
  if (script === "audience") return [KING_RETREAT_AT];
  return BOSS_PHASES.slice(1).map((p) => p.at);
}

/** The health fraction a phase begins at under a script (the lab's phase buttons). */
export function kingPhaseStart(script: BossScript | undefined, phase: number): number {
  if (script === "final") return phase >= 3 ? KING_FINAL_III_AT : 1;
  if (script === "audience") return phase >= 2 ? KING_RETREAT_AT : 1;
  return BOSS_PHASES[Math.min(BOSS_PHASES.length, Math.max(1, phase)) - 1]!.at;
}

/**
 * The phase a boss at this health fraction is in, 1-based.
 *
 * Under `"audience"` the phase II threshold is the retreat's: the change into
 * phase 2 is the armour breaking, and what follows the roar is his leaving
 * (`stepBoss`), never phase II's call. Under `"final"` he is in phase II from
 * full and phase III from `KING_FINAL_III_AT`.
 */
export function bossPhaseAt(hpFraction: number, script?: BossScript): number {
  if (script === "audience") return hpFraction <= KING_RETREAT_AT ? 2 : 1;
  if (script === "final") return hpFraction <= KING_FINAL_III_AT ? 3 : 2;
  let phase = 1;
  BOSS_PHASES.forEach((p, i) => { if (hpFraction <= p.at) phase = i + 1; });
  return phase;
}

/* ============================ subspecies (019) ============================= */

/**
 * **One subspecies per base archetype**: a known body with one verb of its kit
 * changed, so the player answers it differently without learning a new body.
 *
 * The lancer is the rusher's and predates the rest. Everything here is spread
 * from its base, because that is the design rather than a shortcut: a
 * subspecies keeps the behaviour, the health, the reach and the aggro range of
 * the body it varies, and changes **one thing**. What it changes is in
 * `sim/attacks.ts`, `sim/melee.ts` and `sim/enemy.ts`, keyed on the id.
 *
 * Doc 005 gave most of these attacks to *elites*, at about one room in seven.
 * That is too rare to learn, which is what an attack has to be: a body whose
 * answer is different is content, and content belongs where it is met. So the
 * attacks came down to this tier, which the ramp lets a room hold a fifth of,
 * and the elite tier keeps the enrage and one affix.
 *
 * Threat weights are 1.15 to 1.30 times their base's, mean 1.21 — deliberately
 * narrow, because a subspecies is a different question and not a bigger one.
 * They are estimates until the harness calibrates them against hearts lost.
 */
const SUBSPECIES_DEFS: readonly EnemyDef[] = [
  {
    ...SHOOTER,
    id: "pinner", base: "shooter", threat_weight: 2.6, mark_anchor: "core",
    /*
     * One lane, twice. Every window of the shooter's cycle becomes a slow fat
     * shot and a fast thin one a third of a second behind it, down the line it
     * last saw the player on.
     *
     * The shooter's answer is to step off the lane; the pinner's is to step
     * off and **keep going**, because the ground the first shot was walked
     * around is where the second arrives. It costs no new code — a pattern is
     * data — and it keeps the shooter's whole grammar: one thing to read at a
     * time, slow, with a silence to travel in.
     */
    pattern: sequence([
      { pattern: single({ speed: 165, aim: "player", interval: 1.0, size: 1 }), duration: 0.9 },
      { pattern: single({ speed: 300, aim: "player", interval: 1.0, size: 0.7 }), duration: 0.35 },
      { pattern: rest(), duration: 2.6 },
      { pattern: single({ speed: 260, aim: "player", interval: 1.0, size: 0.8 }), duration: 0.9 },
      { pattern: single({ speed: 320, aim: "player", interval: 1.0, size: 0.6 }), duration: 0.35 },
      { pattern: rest(), duration: 3.1 },
    ]),
    description: "Puts two shots down one lane, the second a beat behind the first: step off it, and keep going.",
  },
  {
    ...ORBITER,
    id: "wisp", base: "orbiter", threat_weight: 3.0, mark_anchor: "core",
    /*
     * Its shot **curls**: it steers toward the player for the first half
     * second of flight and then goes straight (`WISP_SEEK_DEG_PER_S`, in
     * `release`). The orbiter's answer is to step off the line; the wisp's is
     * to break the line **late**, because a step taken early is a step the
     * bullet follows. See `sim/enemy.ts`.
     */
    description: "Circles you and curls its shot after you for the first half of its flight: move late, not early.",
  },
  {
    ...TURRET,
    id: "beacon", affix_excluded: ["burning", "shielded"], base: "turret", threat_weight: 2.5, mark_anchor: "core",
    /*
     * Its strike **leaves the ground burning** for a couple of seconds.
     *
     * The turret denies a place for an instant, so the player steps out and
     * steps back; the beacon takes that ground out of play while it burns, so
     * the answer is to leave and *stay* left. It is the same telegraph and the
     * same 900 ms, which is what keeps it a turret.
     *
     * Doc 005's elite turret fired a rift lance instead. That was the rifter's
     * attack on the turret's body, and a variant that answers like another
     * archetype teaches the player nothing.
     */
    description: "Never moves, and the ground its lightning hits keeps burning: leave the mark, and stay off it.",
  },
  {
    ...SENTINEL,
    id: "watcher", base: "sentinel", threat_weight: 2.1, mark_anchor: "core",
    /*
     * The sight line **is** the shot: no travel, live for a third of a second
     * at the end of the aim. The sentinel's slow fat bullet can be walked
     * around after it is fired; the watcher's cannot, so the whole answer moves
     * into the aim.
     */
    description: "Draws its line and then fires along all of it at once: be out of the lane before it lights, not after.",
  },
  {
    ...WARDEN,
    id: "fusilier", base: "warden", threat_weight: 3.1, mark_anchor: "head",
    /*
     * A **second barrel** a beat after the first, 25 degrees off it. The
     * warden's blast is left by stepping out of the cone; the fusilier's
     * second cone covers where that step lands, so the answer is to step
     * *through* rather than around — or to be on it while it reloads, which is
     * now the longer opening of the two.
     */
    description: "Fires twice, the second barrel a beat later and off to one side: step through the cone, not around it.",
  },
  {
    ...BELLRINGER,
    id: "pealer", affix_excluded: ["splitting"], base: "bellringer", threat_weight: 2.4, mark_anchor: "head",
    /*
     * It **peals** instead of tethering: everything within four tiles is
     * warded at once, with no line to stand in. The bellringer's answer is to
     * cut the tether; the pealer's is the kill order — it has to die first,
     * and it is the body that keeps its distance.
     */
    description: "Wards everything near it at once instead of down a line: there is nothing to cut, so it dies first.",
  },
  {
    ...RIFTER,
    id: "quaker", base: "rifter", threat_weight: 2.3, mark_anchor: "core",
    /*
     * Four short cracks **walking toward** the player, each placed ahead of the
     * last. The rifter's one line is answered by stepping across it; the
     * quaker's answer is to step across and then keep moving, because the next
     * crack is laid where the last one sent you.
     */
    description: "Walks four short cracks toward you one after another: cross the first, and do not stop.",
  },
  {
    ...SNARECASTER,
    id: "chainer", base: "snarecaster", threat_weight: 2.6, mark_anchor: "head",
    /*
     * It **anchors** the chain across the floor as a live line rather than
     * throwing it. The snarecaster moves the player; the chainer takes a line
     * of the room away and leaves it there, so the arena is smaller while it
     * lives.
     */
    description: "Anchors its chain across the floor and leaves it live: the room is smaller until it dies.",
  },
  {
    ...DELVER,
    id: "burrower", base: "delver", threat_weight: 2.1, mark_anchor: "head",
    /*
     * It erupts **three times along its heading**, not once where the mound
     * stopped. The delver is answered by leading it; the burrower is answered
     * by leaving its *line*, because the mound's direction is the threat and
     * the stopping place is only the first of them.
     */
    description: "Comes up three times along the line it dived on: leave the line, not the spot.",
  },
  {
    ...CINDERLING,
    id: "emberling", affix_excluded: ["burning", "shielded"], base: "cinderling", threat_weight: 2.2, mark_anchor: "head",
    /*
     * Set alight, it **flares into a ring of fire** rather than only trailing
     * it. The cinderling punishes fire builds by feeding on them; the
     * emberling punishes standing next to one that is already burning, which
     * is exactly where a melee player has to be.
     */
    description: "Burning, it flares into a ring of fire instead of a trail: hit it alight from outside a tile.",
  },
  {
    ...SOWER,
    id: "planter", affix_excluded: ["volatile", "shielded"], base: "sower", threat_weight: 2.5, mark_anchor: "shard_l",
    /*
     * It plants a **ring of seeds round the player**, with two gaps. The sower
     * punishes the dodge; the planter names where the dodge may go, which is
     * the same question asked as a shape rather than as a scatter.
     */
    description: "Plants a ring of seeds round you with two ways out: find a gap before they arm.",
  },
  {
    ...TANK,
    id: "breaker", base: "tank", threat_weight: 5.8, mark_anchor: "head",
    /*
     * Its overhead chop **cracks the floor** three tiles ahead of it. The
     * tank's chop is the answer to being on top of it or behind it, so the
     * safe place is out of its reach; the breaker's crack reaches past that,
     * and the answer is to be out of its *lane* instead.
     */
    description: "Slow and armoured, and its chop splits the floor ahead of it: being out of reach is not being out of the way.",
  },
  {
    ...SUMMONER,
    id: "brooder", affix_excluded: ["splitting"], base: "summoner", threat_weight: 5.4, mark_anchor: "head",
    /*
     * Its thrown flame is a **thrown minion**: the coal hatches a rusher where
     * it lands. The summoner's reinforcements arrive at the summoner, so the
     * player can fight them on the way in; the brooder's arrive at the
     * *player*, so there is no ground that is safely far from it.
     */
    ranged: { kind: "lob", interval_s: 6 },
    description: "Throws coals that hatch where they land, not fire: its reinforcements arrive on top of you.",
  },
];

const BY_ID = Object.fromEntries(SUBSPECIES_DEFS.map((d) => [d.id, d])) as Record<EnemyId, EnemyDef>;

export const ENEMIES: Readonly<Record<EnemyId, EnemyDef>> = {
  ...BY_ID,
  rusher: RUSHER,
  shooter: SHOOTER,
  turret: TURRET,
  orbiter: ORBITER,
  tank: TANK,
  summoner: SUMMONER,
  lancer: LANCER,
  sentinel: SENTINEL,
  warden: WARDEN,
  bellringer: BELLRINGER,
  rifter: RIFTER,
  snarecaster: SNARECASTER,
  delver: DELVER,
  cinderling: CINDERLING,
  sower: SOWER,
  boss: BOSS,
};

/**
 * The roster an encounter may draw from. **The boss is not in it**: it is
 * placed by the boss room and never assembled, so every composition rule,
 * pressure band and concurrency cap below continues to describe the six bodies
 * they were measured against.
 */
export const ENEMY_IDS: readonly AssemblableId[] =
  ["rusher", "shooter", "turret", "orbiter", "tank", "summoner", "lancer", "sentinel",
    "warden", "bellringer", "rifter", "snarecaster", "delver", "cinderling", "sower",
    ...SUBSPECIES_DEFS.map((d) => d.id as AssemblableId)];

/** Everything including the boss, for renderers and frame checks. */
export const ALL_ENEMY_IDS: readonly EnemyId[] = [...ENEMY_IDS, "boss"];

/* --------------------------- subspecies helpers --------------------------- */

/**
 * The base a body varies, or itself.
 *
 * Total over `EnemyId`, and the single place the pairing is read: the roster
 * cap counts a breaker as a tank, the mix ratios hand a subspecies a share of
 * its base's, and the renderer asks its base for the frames.
 */
export function baseArchetype(id: EnemyId): EnemyId {
  return ENEMIES[id].base ?? id;
}

/** The key a per-archetype table is written with: a base body, or the boss. */
export type BaseKey = BaseEnemyId | "boss";

/**
 * Completes a per-archetype table by giving every subspecies its base's row.
 *
 * Perception lag, gait, atlas name, class: each is written for the bodies a
 * player can name, and a subspecies shares all of them with its base by
 * construction — it is the same body with one verb changed, and none of these
 * is the verb. So a table states the bases and this fills the rest, which
 * keeps the thirteen from being thirteen more rows in every table in the game
 * and makes a body that *should* differ an explicit row rather than an
 * omission. The lancer's own drawn model is exactly that: it states
 * `enemy_lancer` and keeps it.
 */
export function fillSubspecies<T>(table: Readonly<Partial<Record<EnemyId, T>>>): Record<EnemyId, T> {
  const out = { ...table } as Record<EnemyId, T>;
  for (const id of ALL_ENEMY_IDS) {
    if (out[id] === undefined) out[id] = table[baseArchetype(id)] as T;
  }
  return out;
}

export function isSubspecies(id: EnemyId): boolean {
  return ENEMIES[id].base !== undefined;
}

/**
 * The base, as the key a per-archetype table is written with.
 *
 * Every such table — perception lag, gait, atlas name, class — is written for
 * the bodies a player can name, and a subspecies shares all of them with its
 * base by construction. Rather than thirteen more rows in each, they are keyed
 * on `BaseEnemyId` and read through here.
 */
export function baseKey(id: EnemyId): BaseKey {
  return baseArchetype(id) as BaseKey;
}

/** The subspecies of a base, or null. The lancer is the rusher's. */
export const SUBSPECIES_OF: Readonly<Record<EnemyId, EnemyId | null>> = (() => {
  const out: Partial<Record<EnemyId, EnemyId | null>> = {};
  for (const id of ALL_ENEMY_IDS) out[id] = null;
  for (const id of ALL_ENEMY_IDS) {
    const b = ENEMIES[id].base;
    if (b) out[b] = id;
  }
  return out as Record<EnemyId, EnemyId | null>;
})();

/** Every subspecies id, in roster order. */
export const SUBSPECIES_IDS: readonly EnemyId[] = ENEMY_IDS.filter(isSubspecies);

/** Every base archetype, in roster order: what a composition is written over. */
export const BASE_ENEMY_IDS: readonly BaseEnemyId[] =
  ENEMY_IDS.filter((id) => !isSubspecies(id)) as BaseEnemyId[];

export function enemy(id: EnemyId): EnemyDef {
  return ENEMIES[id];
}

export function threatWeight(id: EnemyId): number {
  return ENEMIES[id].threat_weight;
}

export function patternOf(id: EnemyId): PatternNode | null {
  return ENEMIES[id].pattern;
}

/** Melee archetypes gain from cover and lose in open rooms; ranged do the reverse. */
export type EnemyClass = "melee" | "ranged";

const CLASSES: Readonly<Record<EnemyId, EnemyClass>> = fillSubspecies<EnemyClass>({
  rusher: "melee",
  tank: "melee",
  shooter: "ranged",
  turret: "ranged",
  orbiter: "ranged",
  // A summoner never shoots, but it plays from the back line and is read as ranged.
  summoner: "ranged",
  sentinel: "ranged",
  warden: "ranged",
  bellringer: "ranged",
  rifter: "ranged",
  snarecaster: "ranged",
  delver: "melee",
  cinderling: "melee",
  sower: "ranged",
  /*
   * Classed as **melee**, although it also shoots.
   *
   * The class decides which pressure budget a body is counted against and how
   * the player is expected to answer it, and the boss's answer is the melee
   * one: it walks at you and swings, and the bullets are what shape the
   * approach rather than what does the killing. It is never assembled into an
   * encounter, so the classification costs the pressure model nothing either
   * way — but leaving it unclassified would make it ranged by default, which
   * is the wrong thing for anything reading this table.
   */
  boss: "melee",
});

/**
 * A subspecies is classed as its base. It keeps the base's behaviour, so how
 * the player is expected to answer it — close, or hold the distance — is the
 * same answer, which is the whole thing the class decides.
 */
export function enemyClass(id: EnemyId): EnemyClass {
  return CLASSES[id];
}

/**
 * The summoner population cap and the global concurrency cap are one gate at
 * runtime (doc 005, "Validation"): a minion spawns only while both the shared
 * minion pool and the twelve concurrent slots have room. Keeping it a runtime
 * gate rather than a planning reservation is what lets a dense roster still
 * contain a summoner without the encounter's size jumping when one is drawn.
 */
export function canSpawnMinion(alivePopulation: number, minionsAlive: number): boolean {
  return minionsAlive < SUMMONER_MINION_CAP && alivePopulation < MAX_CONCURRENT_ENEMIES;
}
