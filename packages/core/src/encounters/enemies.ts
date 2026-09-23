/**
 * The six enemy archetypes (design doc 005, "Enemy archetypes").
 *
 * An enemy is data: a movement behaviour, a bullet pattern and stats. Threat
 * weight is the only field the pressure formula reads; it is an estimate until
 * the harness (011) calibrates it against hearts lost.
 */
import type { EnemyArchetype, EnemyId, PatternNode, AssemblableId, MeleeKind } from "../types.ts";
import { burst, fan, rest, ring, sequence, single, spiral } from "./patterns.ts";

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
  description: "Walks up and drives its spikes out all round, close; kept at a pace, it is cut before it can.",
  summon: null,
};

const SHOOTER: EnemyDef = {
  id: "shooter",
  // Cut from 300. A body that engages before the player can make out what it
  // is takes the choice of when to fight away from them, and for the ranged
  // archetypes that choice is most of the tactics they have.
  aggro_range: 230,
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
  pattern: sequence([
    { pattern: single({ speed: 165, aim: "player", interval: 1.0, size: 1 }), duration: 1.6 },
    { pattern: rest(), duration: 1.8 },
    { pattern: single({ speed: 260, aim: "player", interval: 1.0, size: 0.8 }), duration: 1.6 },
    { pattern: rest(), duration: 1.9 },
    // The second move: a three-shot burst, small and quick, down one aimed
    // line. Still one lane to step off — but a lane that has to be stepped
    // off *now*, where the single shots could be walked around.
    { pattern: single({ speed: 240, aim: "player", interval: 0.22, size: 0.7 }), duration: 0.66 },
    { pattern: rest(), duration: 2.2 },
  ]),
  threat_weight: 1.5,
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
  // Its arm is a gun (the delivered sheet drew it so): a heavy body that holds
  // a middle distance and fires a blunderbuss. See `fireMusket`.
  behaviour: "keep_distance",
  pattern: null,
  // A room-sized threat at 3.2 s and a wider, longer gout, measured by eye:
  // it pressed like a boss. A heavy body's shot should be an event.
  ranged: { kind: "musket", interval_s: 4.2 },
  melee: null,
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
  description: "Tethers an ally and armours it while the line holds; stand in the line to cut it, or kill the ringer and every ward goes. Rings a slowing field under itself. The elite peals instead, arming everything near it at once.",
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
  description: "Lays its chain on the floor along the line it will throw, then drags you in on a hit. Dash through it or break the line with a pillar. The elite anchors the chain across the floor, a live line that costs to cross.",
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
  description: "Fights on the surface for a few seconds, then dives and travels as a mound you can see; where the mound stops, it erupts. Lead it into fire. The elite erupts three times along its line.",
  summon: null,
};

/** A walking coal that is delighted to be set on fire. */
const CINDERLING: EnemyDef = {
  id: "cinderling",
  aggro_range: 220,
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
  aggro_range: 230,
  behaviour: "orbit",
  pattern: null,
  ranged: { kind: "mine", interval_s: 2.2 },
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
  pattern: sequence([
    { pattern: single({ speed: 200, aim: "player", interval: 0.95, size: 0.9 }), duration: 1.3 },
    { pattern: rest(), duration: 1.3 },
    { pattern: single({ speed: 175, aim: "player", interval: 1.15, size: 0.9 }), duration: 1.5 },
    { pattern: rest(), duration: 1.4 },
    // The second move: a quick pair from wherever the circle has taken it.
    { pattern: single({ speed: 230, aim: "player", interval: 0.25, size: 0.8 }), duration: 0.5 },
    { pattern: rest(), duration: 1.6 },
  ]),
  threat_weight: 2.0,
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
  aggro_range: 260,
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
  hp: 1250,
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
    "The floor's master. Three phases, each faster and wider than the last: it "
    + "walks and shoots, then rams and rings, then spirals; armoured until you "
    + "break it, and it never stops walking toward you.",
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
  /** The blade used when far, and when the player is on top of it or behind it. */
  readonly melee: { readonly far: MeleeKind; readonly near: MeleeKind };
  /** How far "far" is, in px. */
  readonly farPx: number;
}

export const BOSS_PHASES: readonly BossPhase[] = [
  {
    at: 1, name: "I",
    pattern: sequence([
      // Aimed and slow: the tell the later phases reuse.
      { pattern: single({ speed: 200, aim: "player", interval: 1.1, size: 1.2 }), duration: 2.4 },
      { pattern: rest(), duration: 1.2 },
      // A spread, so standing directly in front stops being the answer.
      { pattern: fan({ speed: 215, count: 3, spread_deg: 34, aim: "player", interval: 1.5, size: 1 }), duration: 2.6 },
      { pattern: rest(), duration: 1.2 },
    ]),
    rate: 1, speed: 1.05, melee: { far: "slash", near: "slash" }, farPx: 999,
  },
  {
    at: 0.6, name: "II",
    pattern: sequence([
      { pattern: fan({ speed: 220, count: 5, spread_deg: 48, aim: "player", interval: 1.3, size: 1 }), duration: 2.6 },
      { pattern: rest(), duration: 0.9 },
      // A ring: nowhere is safe, only the gaps are, and it has to be crossed.
      { pattern: ring({ speed: 180, count: 10, interval: 2.0, rotate_deg: 18, size: 0.9 }), duration: 2.0 },
      { pattern: rest(), duration: 0.8 },
      { pattern: single({ speed: 240, aim: "player", interval: 0.7, size: 1.2 }), duration: 2.1 },
      { pattern: rest(), duration: 1.0 },
    ]),
    rate: 1.15, speed: 1.15, melee: { far: "charge", near: "cleave" }, farPx: 120,
  },
  {
    at: 0.3, name: "III",
    pattern: sequence([
      { pattern: spiral({ arms: 3, angular_speed: 90, speed: 170, interval: 0.35, size: 0.9 }), duration: 3.0 },
      { pattern: rest(), duration: 0.7 },
      { pattern: ring({ speed: 190, count: 14, interval: 1.6, rotate_deg: 12, size: 0.9 }), duration: 1.6 },
      { pattern: rest(), duration: 0.6 },
      { pattern: fan({ speed: 235, count: 5, spread_deg: 60, aim: "player", interval: 1.0, size: 1 }), duration: 2.0 },
      { pattern: rest(), duration: 0.7 },
    ]),
    rate: 1.3, speed: 1.3, melee: { far: "charge", near: "cleave" }, farPx: 110,
  },
];

/** The phase a boss at this health fraction is in, 1-based. */
export function bossPhaseAt(hpFraction: number): number {
  let phase = 1;
  BOSS_PHASES.forEach((p, i) => { if (hpFraction <= p.at) phase = i + 1; });
  return phase;
}

export const ENEMIES: Readonly<Record<EnemyId, EnemyDef>> = {
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
    "warden", "bellringer", "rifter", "snarecaster", "delver", "cinderling", "sower"];

/** Everything including the boss, for renderers and frame checks. */
export const ALL_ENEMY_IDS: readonly EnemyId[] = [...ENEMY_IDS, "boss"];

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

const CLASSES: Readonly<Record<EnemyId, EnemyClass>> = {
  rusher: "melee",
  tank: "melee",
  shooter: "ranged",
  turret: "ranged",
  orbiter: "ranged",
  // A summoner never shoots, but it plays from the back line and is read as ranged.
  summoner: "ranged",
  lancer: "melee",
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
};

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
