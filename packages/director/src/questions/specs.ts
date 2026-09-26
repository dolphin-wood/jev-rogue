/**
 * **The options as specs**, for the arm whose state is the briefing.
 *
 * With a state of labels, an option's job is to name the labels it fits, and
 * `grounded()` appends that clause mechanically. With a briefing there are no
 * labels to name — the state is the run written out — so an option that ended
 * in "Fits when build shape is raw" would be asserting a field that is not
 * there, and the assertion would have to be matched against prose that never
 * uses the phrase.
 *
 * What replaces it is the form the choice API offers: **what** the option is,
 * **what it is not for**, and **examples**. Two things the fit clause could
 * not carry:
 *
 * - a *negative*. "Not for a staff with every key full" is the single most
 *   useful thing to say about a spell door, and a clause that can only assert
 *   that a field *is* one of some values cannot say it. The old code got at it
 *   sideways, by listing every value of a field but one (`notThisOne`), which
 *   works arithmetically and reads as noise.
 * - *room for the design intent to stay in the instructions*, where it belongs.
 *   A reward-design principle is a rule about the offer, not a property of one
 *   option, and putting it on each option made every option argue.
 *
 * **Examples are rare here, and that is deliberate.** Every option used to
 * carry two or three lines of the briefing as examples; measured, that is a
 * way of writing the answer down. An example says "a state that looks like
 * this is this option", and with three of them on every option of every
 * question the specs stop describing the options and start prescribing the
 * mapping — which is the weight table again, in prose. They are kept only
 * where two options are genuinely easy to confuse and one line of state is the
 * whole of what separates them, and they are written generically.
 *
 * Every example below is a line the briefing can actually print. When the
 * briefing's wording changes, these have to change with it — which is the
 * point: they are the same document read from the other end.
 */
import {
  DENSITY_TARGETS, ITEMS, MERCHANT_PRICE, SMITH_PRICE, spellAffixById, statById,
} from "@jr/core";
import type { BaseItem, Density, Feature, SpaceArchetype } from "@jr/core";
import type { OptionSpec } from "../types.ts";
import { LANE_SPEC, laneOf } from "./affixes.ts";

/**
 * The openings of the briefing's last-room lines, so the two options of a
 * look-only question have the one state line that separates them shown rather
 * than described. Measured, with the fact buried in the room's own comma list,
 * brightness came back the same answer in 97% of rooms; with the line present
 * but no example pointing at it, the temperature and the particles each went
 * about ten points *more* concentrated than with one.
 *
 * One head per part of the look, and the briefing prints one line per part
 * (`runLines`) — so a question's example is the line its own answer is read
 * off, and carries no value of a field it does not decide.
 */
export const LAST_LOOK = {
  layout: "Last room's layout: ",
  light: "Last room's light: ",
  brightness: "Last room's brightness: ",
  particles: "Last room's particles: ",
} as const;

/*
 * **What a badge shown over and over is not for — gone from every kind.**
 *
 * Each of the four reward kinds used to end its negative with a clause of the
 * form "a run where the <kind> badge has been on several offers running,
 * where the player has stopped choosing between the doors and simply walks
 * through the one they always do". Two things were wrong with it, and they
 * pull the same way.
 *
 * It is a **sentence built round the option it is written on**, narrating the
 * player's behaviour toward that option — which finding 5a measures at up to
 * forty points *in favour of* the option, whichever way the behaviour ran.
 * And it is now unanswerable: the streak counts left the briefing with the
 * rest of the door narration, so there is nothing in the state for the clause
 * to be true or false against.
 *
 * Which leaves the limit where finding 5 says it belongs: `DOOR_STREAK_CAP`
 * withholds every kind that has been on four offers running, and the tail
 * temperature spreads what stands beside the top answer. Measured with the cap
 * off and nothing about streaks anywhere in the request, the affix badge still
 * reached ten consecutive offers.
 */

/* ------------------------------------------------------- what a door pays */

/*
 * **What each door does, and nothing about how it ranks.** The first three
 * each carried a sentence placing the kind against the others — "the only
 * door that changes what the player can do at all", "which is how three
 * separate spells become one build", "the only reward ... a build with
 * nothing left to fill can still spend" — which is a verdict on the pool
 * written into the option (finding 11, doc 010 rule 2). Each now says where
 * its card goes on the staff, which is the fact those sentences were
 * gesturing at, and the negatives say what the card leaves undone rather than
 * that it "does less".
 */
export const KIND_SPEC: Readonly<Record<string, OptionSpec>> = {
  spell: {
    what: "A spell door. A new spell goes on the first empty key; a copy of a spell already held raises "
      + "that key's level and fills no key. To a staff with all three keys full it offers both copies, "
      + "which raise a level, and new spells, each of which replaces one held spell. The build section "
      + "says which keys are empty and what level each held spell is at.",
    not_for: "A staff whose three keys are full and raised, where a new spell takes the place of a "
      + "raised one.",
  },
  affix: {
    what: "An affix door. It attaches a modifier to a spell already held — it chains, it burns, it comes "
      + "back off walls — in one of that key's affix slots; a duplicate raises the tier of the one "
      + "attached. It fills no key. The build section says how many affix slots are still open across the "
      + "staff, and which are on which key.",
    not_for: "A staff with no affix slot left anywhere, where the card can only raise the tier of an "
      + "affix already attached.",
  },
  /*
   * **What each family raises, by name**, because a player asks for these in
   * their own words — "faster attacks", "more health" — and "movement,
   * survival, mana or the sword" gave a request like that nothing to meet:
   * the swing recovering sooner is on this door and nowhere said so.
   *
   * **And a negative that tells states apart.** It was "a run with an empty
   * key", which every early room is: the first room always has two, so the
   * clause was a standing verdict against the stat door for the opening of
   * every run rather than a reason in any one state (finding 20's converse).
   * It is written now from the four things the door raises, and holds only
   * where none of them has been what stopped the player.
   */
  stat: {
    what: "A stat door. It raises the player rather than a spell. Movement: faster walking, the dash back "
      + "sooner or further. Survival: more health, longer safety after a hit, one more rage segment. Mana: "
      + "a bigger bar, faster refill, more mana back from each sword hit. The sword: harder hits, a longer "
      + "reach, a swing that recovers sooner. It fills no key and no affix slot. The build section says "
      + "which stats the run has already taken.",
    not_for: "A player whose mana has not refused a cast, whose health has held and whose own words ask "
      + "nothing of speed, health, mana or the sword, where the card raises a number that was not what "
      + "stopped them.",
  },
  /*
   * **One claim, like the other three.** This carried two sentences making
   * gold's case ("the one reward that is a choice made later rather than now,
   * and the one that pays for a card the run never offered") and priced the
   * purse against the shelf inside the option ("with change"), which is the
   * option arguing for itself over facts the state already prints. Gold is
   * never the top answer anyway (finding 6), so the argument bought nothing
   * and the length was a thumb on the scale (finding 1).
   */
  gold: {
    what: `A gold door. It scatters a purse the player carries to a merchant or a smith: a card at the `
      + `merchant costs ${MERCHANT_PRICE["stat"]} to ${MERCHANT_PRICE["spell"]}, a level at the smith `
      + `${SMITH_PRICE[1]} upward. The purse is spent in a later room; nothing goes on the staff in this `
      + `one. The Right now section says what the purse holds and what it buys.`,
    not_for: "A player carrying more gold than everything at the stop costs, for whom a second purse "
      + "buys nothing the first did not.",
  },
};

export const NPC_SPEC: Readonly<Record<string, OptionSpec>> = {
  merchant: {
    what: `A door to the merchant instead of a fight: one shelf, one card of each kind, bought with gold `
      + `(spell ${MERCHANT_PRICE["spell"]}, affix ${MERCHANT_PRICE["affix"]}, stat ${MERCHANT_PRICE["stat"]}). `
      + "The player buys whichever of the three the purse covers, or none, instead of keeping one of three "
      + "cards dealt. There is no fight, so it costs this room's reward.",
    not_for: "A player with too little gold to buy anything on the shelf, or a run that has just come "
      + "through another room with no fight in it.",
    examples: ["Gold: 62"],
  },
  smith: {
    what: `A door to the smith instead of a fight: one held spell's level raised for gold `
      + `(${SMITH_PRICE[1]} from level 1, up to ${SMITH_PRICE[4]} from level 4). There is no fight, so it `
      + "costs this room's reward.",
    not_for: "A staff with an empty key, where a level raises a held spell and the empty key stays empty, "
      + "or a player who cannot afford a level.",
    examples: ["Spell levels: all keys at level 1; none raised"],
  },
  fountain: {
    what: "A door to a fountain instead of a fight: one drink, half the bar back, and then it is dry. "
      + "Health does not otherwise return inside a run. There is no fight, so it costs this room's "
      + "reward.",
    not_for: "A player near a full bar: the drink stops at a full bar, and the room's cards are not dealt.",
  },
};

/* ------------------------------------------------------- the harder fight */

export const ELITE_PORTAL_SPEC: Readonly<Record<string, OptionSpec>> = {
  none: {
    what: "Every door out of this room leads to an ordinary fight. The run keeps its current pitch.",
    not_for: "A player clearing quickly on a full bar who has taken nothing for two rooms, for whom every "
      + "door out is a fight at the pitch they are already clearing.",
  },
  elite: {
    what: "One door out of this room leads to an elite fight: the same kind of room built harder, for a "
      + "reward graded up one or two steps.",
    not_for: "A player who is behind — low on health, clearing slowly, or just out of a room that cost "
      + "them heavily.",
  },
};

/*
 * The grades say how far up the reward goes, and the negatives name the
 * state lines they are read off (health, the last rooms' damage, clear speed)
 * rather than "the best roll the game has" and "a run with nothing left to
 * want", which were a ranking of the option and a verdict on the player.
 */
export const ELITE_GRADE_SPEC: Readonly<Record<string, OptionSpec>> = {
  raised: {
    what: "The elite door's reward is graded up one step, the grade every elite door carries at the least.",
    not_for: "A player who is low on health, has been clearing slowly, or has just lost heavily in a room.",
  },
  best: {
    what: "The elite door's reward is graded up two steps, which is as far as a grade goes. The second "
      + "step is how the game lets a run that is behind make up ground.",
    not_for: "A player on a full bar who has been clearing quickly and has lost little over the last rooms.",
  },
};

export const NORMAL_GRADE_SPEC: Readonly<Record<string, OptionSpec>> = {
  ordinary: {
    what: "The ordinary rewards, at the grade this run has been dealing all along.",
    not_for: "A player who has ground to make up before the boss and only a few rooms left to make it in.",
  },
  raised: {
    what: "Every door's reward is graded up one step for the rooms left before the stop.",
    not_for: "A player on a full bar who has been clearing quickly and has lost little over the last rooms.",
  },
};

/* ------------------------------------------------- what a door's badge says */

/**
 * **The four stat families: one sentence each, one negative each, one example
 * each.**
 *
 * The regression this is answering: `survival` took 75% of the question.
 * `survival`'s own text was the longest of the four and the extra clause was
 * an argument — "health does not otherwise return inside a run, so this is the
 * one family that buys the run more room to go wrong" — which is the case for
 * the option written on the option (findings 1 and 4).
 *
 * And this is one of the two questions finding 3 says examples are the
 * mechanism for, not noise: the four families are not confusable as
 * *descriptions*, they are confusable as *states*, because every state can be
 * read as wanting any of them. Each carries one, and each names a **different
 * measured line**, so the example teaches which fact the option is read off
 * rather than repeating what the option is.
 */
export const FAMILY_SPEC: Readonly<Record<string, OptionSpec>> = {
  movement: {
    what: "Movement: move speed, a shorter dash cooldown, a longer dash.",
    not_for: "A player who has spent little of the last fights with an enemy bullet close.",
    examples: ["Time spent with an enemy bullet close: heavy"],
  },
  survival: {
    what: "Survival: more health filled, a longer invulnerability window after a hit, a deeper rage gauge.",
    not_for: "A player who has lost little health over the last fights.",
    examples: ["Health lost over the last two rooms: heavy"],
  },
  mana: {
    what: "Mana: a deeper bar, faster trickle, more mana back per sword hit.",
    not_for: "A bar that has refused no cast and spent little time under the cheapest key.",
    examples: ["Casts the bar refused for want of mana: often"],
  },
  sword: {
    what: "Sword: harder swings, a wider crescent, a faster recovery. A connecting swing also returns mana.",
    not_for: "A run in which the sword has done little of the damage.",
    examples: ["Share of the damage the sword did: reads as most"],
  },
};

/* ------------------------------------------------------------ the offer */

/**
 * **How widely the offer is drawn, read off the cards the player kept.**
 *
 * This answered `low` in 84% of offers, and `low` for 9 of 14 with two
 * off-style picks running (jev-findings 28, 30). Two things did it. The
 * negatives of `medium` and `high` were both "a player who has committed to
 * one direction and is being paid for it", and the only line in the briefing
 * that reads as commitment is which way the keys lean — which is the stated
 * style in nine states of ten, because the starter is on every staff. So two
 * options out of three were wrong for nearly every state and `low`, whose
 * negative was the one the state rarely showed, was the sink (finding 2).
 * And the fact they were meant to be read off arrived as a bare bucket,
 * "of the last three: 2", which does not say what was kept.
 *
 * Each option now says what it does to the draw, and each negative names the
 * one line it is read off — how many of the last three cards kept are off the
 * stated style, which the briefing prints with the cards themselves. And each
 * carries one example, that line at a value: the three options differ only by
 * which value of one line applies, which is finding 3's case for an example
 * (the stat families and the anchor are the others). A first pass without
 * them, the count printed the other way round ("tagged with the stated
 * style: 0 of 3") and the negatives only, still answered `low` at 0.9 with
 * three cards of three off the style.
 */
export const VARIETY_SPEC: Readonly<Record<string, OptionSpec>> = {
  low: {
    what: "A narrow offer: the draw keeps to the cards that fit this build and the stated style most "
      + "closely.",
    not_for: "A player two or three of whose last three cards kept are off the stated style.",
    examples: ["Of those, off the stated style: 0 of 3; of the newest two: 0"],
  },
  medium: {
    what: "A middling offer: mostly the closest fits, and now and then a card from further out.",
    not_for: "A player none of whose last three cards kept is off the stated style, or whose newest two "
      + "both are.",
    examples: ["Of those, off the stated style: 1 of 3; of the newest two: 1"],
  },
  high: {
    what: "A wide offer: cards from further out — other styles, other roles — beside the closest fits.",
    not_for: "A player none of whose last three cards kept is off the stated style.",
    examples: ["Of those, off the stated style: 2 of 3; of the newest two: 2"],
  },
};

/* ----------------------------------------------------------- the encounter */

export const COMPOSITION_SPEC: Readonly<Record<string, OptionSpec>> = {
  melee_heavy: {
    what: "Mostly bodies that close in. Range is the answer and footwork is the cost.",
    not_for: "A player already losing most of their health to blades.",
    examples: ["What took the most health: enemy blades"],
  },
  ranged_heavy: {
    what: "Mostly shooters that keep their distance. Closing the gap is the answer.",
    not_for: "A player already being shot to pieces from across the room.",
    examples: ["What took the most health: enemy shots"],
  },
  mixed: {
    what: "An even mix of bodies that close and bodies that shoot. It presses nothing in particular.",
    not_for: "A player whose damage is nearly all the sword's or nearly all the spells', whom a mix "
      + "presses from neither side; and a room at the top of the run's pitch, where the mix leaves the "
      + "hardest room without one kind of body to answer.",
  },
  siege: {
    what: "Slow, heavy bodies and emplacements that hold ground: a long fight with a kill order in it.",
    not_for: "A room pitched as a breather, or a player who has been clearing slowly already.",
  },
};

/**
 * **How many bodies the room holds, which is not how many stand at once.**
 *
 * These said "few bodies on the floor at once" and "many bodies at once: the
 * hardest crowd", which is the wrong quantity: the count this question sets is
 * the room's **total over the whole fight**, and the crowd — how many of them
 * are standing together — is the run-progress ramp's and no answer moves it.
 * A room 1 that may hold twelve bodies and never more than four at a time is a
 * middling total and a small crowd, and an option that conflates the two is
 * describing a room the game does not build.
 *
 * The figures are `DENSITY_TARGETS`, read off the assembler rather than typed,
 * and they are **per round**: a room plays one round or two (doc 014), and the
 * room's own ceiling is in the state beside its pitch.
 */
const bodies = (d: Density) => `${DENSITY_TARGETS[d][0]} to ${DENSITY_TARGETS[d][1]}`;

export const DENSITY_SPEC: Readonly<Record<string, OptionSpec>> = {
  sparse: {
    what: `${bodies("sparse")} bodies in a round: the shortest fight the room can be built as.`,
    not_for: "A player on a full bar clearing fast, for whom an empty room is a walk.",
  },
  normal: {
    what: `${bodies("normal")} bodies in a round: enough to be a fight, not enough to be a crowd.`,
    not_for: "A room pitched as a breather for a player who is hurt, and not a peak on a full bar — at a "
      + "middling count both of those are the same room, and a run of nothing but middling rooms is flat.",
  },
  dense: {
    what: `${bodies("dense")} bodies in a round, or the room's own ceiling where that is lower: the `
      + "longest fight the run currently allows.",
    not_for: "A player who is low, has just taken heavy damage, or has been clearing slowly.",
  },
};

export const WAVES_SPEC: Readonly<Record<string, OptionSpec>> = {
  breathe: {
    what: "The floor clears before the next group arrives: room to breathe, reposition and let mana come "
      + "back between them.",
    not_for: "A fight the door promised would be hard: taking each group alone makes the room a queue.",
  },
  steady: {
    what: "The next group arrives as the last of this one falls: a fight that keeps moving without ever "
      + "piling up.",
    not_for: "A room meant as a breather, where the floor actually clearing is the point of it; and a "
      + "peak, where the whole point is that it does not.",
  },
  relentless: {
    what: "The next group arrives while this one is still standing: no gap to reset in.",
    not_for: "A player who is low or has just been hurt badly — there is nowhere in this room to recover.",
  },
};

/**
 * **The one place an example was measured to be irreplaceable.**
 *
 * Nothing about these three options changed in this pass except that their
 * examples were removed, and the answer went from `tank` 56% to `none` 99%.
 * A priority target and a plain crowd are not confusable as *descriptions* —
 * they are confusable as *states*, because every state can be read as either,
 * and the clear speed is the only line that separates them. So one generic
 * example each, and the positive case for `none` that it never had.
 */
export const ANCHOR_SPEC: Readonly<Record<string, OptionSpec>> = {
  /*
   * **Three sentences of the same length, and one example each.**
   *
   * Measured after the last pass, `none` took 85% of rooms. Two things were
   * doing it, and neither was the example. `none`'s `what` ran to three
   * clauses against `tank`'s one, and finding 1 is that a question over
   * options of unequal length is decided by whichever carries the most
   * clauses; and the last of those clauses — "a run needs these to make the
   * rooms that do have an order read as different" — is the *instruction*
   * arguing one option's case from inside an option, which is finding 4 with
   * the argument moved one field to the left. Both are gone. What is left on
   * each is what the room is like to fight, in one sentence, and the one
   * state line that separates it from its neighbours.
   */
  none: {
    what: "No priority target: the room is a crowd, it ends when the floor is clear, and the player kills "
      + "in whatever order they like.",
    not_for: "A player clearing fast on a full bar, and a room at the top of the run's pitch, where a "
      + "crowd with nothing in it is a hard room with no subject.",
    examples: ["Clear speed against what this player usually takes: slow"],
  },
  tank: {
    what: "A slow, armoured body to focus first: the room has an order to kill in, and the crowd is the "
      + "cost of working through it.",
    not_for: "A player clearing slowly, who will spend the room on the one body; and a room meant as a "
      + "breather, where a body that takes a while is the opposite of one.",
    examples: ["Clear speed against what this player usually takes: fast"],
  },
  summoner: {
    what: "A body that adds more until it dies: the room does not end until it does, and the crowd grows "
      + "while it stands.",
    not_for: "A build that cannot kill it quickly — the room then stops ending rather than getting harder "
      + "— and a player who has been clearing slowly.",
    examples: ["Damage the player deals: reads as high"],
  },
};

export const ENTRY_SPEC: Readonly<Record<string, OptionSpec>> = {
  far_front: {
    what: "Enemies arrive from the far side: the most time to see them coming and to choose where to stand.",
    not_for: "A player on a full bar who has not been threatened in two rooms.",
  },
  flanks: {
    what: "Enemies arrive from both sides at once: the player has to turn, and cannot hold one line.",
    not_for: "A player who is low or has just taken heavy damage; and a room at the top of the run's "
      + "pitch on a full bar, where being able to back into a corner is the thing to take away.",
  },
  surround: {
    what: "Enemies arrive from all round: the hardest entry, and nowhere to back into.",
    not_for: "Anything but a player on a full bar who has taken nothing recently.",
  },
  turrets_center: {
    what: "Emplacements in the middle with bodies round them: a fixed threat to work round rather than a "
      + "crowd to clear.",
    not_for: "A player who fights close, for whom the middle is where they have to be.",
  },
};

/**
 * **How much of the room is variants**, which is also the yes-or-no.
 *
 * `none` used to be an option of the *variant ranking* as well, and a ranking
 * whose first entry is "no variants" is a yes-or-no hidden inside a which-one:
 * measured, it took 71% of rooms. The ranking now asks only which kinds, and
 * the whole of whether is here, where it was already an answer.
 */
/**
 * **Left as it was, on the measurement.**
 *
 * This was rewritten to the parity rule finding 20 states — `none`'s three
 * clauses of its own case cut to one, its neighbours' hedging cut to match —
 * and the fact its instruction names was added to the state at the same time
 * (how many of the fights so far held a variant body). Measured over the same
 * eight seeds at each step, `none` went **66% → 90% → 100%**: the parity that
 * moved `elite_presence` three points the right way moved this three times as
 * far the wrong way, and the state fact, which can only say "the run has been
 * plain", read as a case for more of the same however it was phrased. Both are
 * reverted; the numbers are in finding 26 and the answer is a code floor, not
 * a better sentence.
 */
export const SUBSPECIES_WEIGHT_SPEC: Readonly<Record<string, OptionSpec>> = {
  none: {
    what: "No variants: every body is exactly the one it looks like. Each body in the room behaves as it "
      + "is drawn and as the player has already met it this run, and a variant in the next room is read "
      + "against these.",
    not_for: "A run that has been plain for several rooms together, where the bodies have been read so "
      + "often the fight is answered without looking at it.",
  },
  some: {
    what: "A few of the room's bodies are variants: enough to notice, not enough to relearn the room.",
    not_for: "A room whose fight is already a lot to read — a crowd at the top of the run's pitch, or a "
      + "player who is low — where one body that answers differently is one thing too many.",
  },
  many: {
    what: "Most of what can be a variant is one: the room reads familiar and answers differently.",
    not_for: "An early room, where the player is still learning what the ordinary bodies do; or a player "
      + "who is behind — a room that lies about itself is the last thing they need.",
  },
};

/**
 * **The same correction as `SUBSPECIES_WEIGHT_SPEC`.** `none` answered 88% of
 * rooms with the longest `what` on the list — three clauses arguing that a
 * room dropping no heal and no coin is what keeps the next rooms costing
 * something — and the shortest `not_for`, while `one` carried three clauses of
 * hedging. One sentence of what it is, one sentence of what it is wrong for,
 * on each.
 */
export const ELITE_PRESENCE_SPEC: Readonly<Record<string, OptionSpec>> = {
  none: {
    what: "No enraged bodies: the room is as hard as its crowd and its pitch make it, and nothing in it "
      + "drops a heal or a coin.",
    not_for: "A player on a full bar who has taken little for two rooms, and a room whose crowd is small "
      + "enough that there is nothing in it to aim at first.",
  },
  one: {
    what: "One enraged body hidden in the room: the same fight at twice the health and a little more "
      + "damage, dropping a heal and a coin when it falls.",
    not_for: "A player who is low or has just been hurt badly, for whom one more body that does not die "
      + "is the room going wrong.",
  },
  two: {
    what: "Two enraged bodies: two things in the room to pick a kill order for, and two heals to be "
      + "had for killing them.",
    not_for: "A room already at the run's densest crowd, where a second body that takes twice the killing "
      + "makes the room longer rather than harder.",
  },
};

/* --------------------------------------------------------------- the room */

/**
 * The pitch. Each of the three is wrong for the run that has just had several
 * of it, because the pitch is the one decision that is about the *sequence*
 * rather than about this room: a run of nothing but `build` and a run of
 * nothing but `peak` are equally shapeless, and the briefing prints the series
 * and the count of fights since the run last let up.
 */
export const TENSION_SPEC: Readonly<Record<string, OptionSpec>> = {
  /*
   * **Neither the middle nor the bottom argues its own case.**
   *
   * `build` closed with "the pitch most rooms sit at" — the default written on
   * the default — and `release` with two clauses on why a run needs one.
   * Measured over 8 seeds and 100 fights with both in place: build 85%, peak
   * 14%, **release 1%**, with release never chosen even after thirteen fights
   * without a let-up and never chosen for a player at one heart. Both are
   * gone, and the negatives name the state line the briefing actually prints
   * ("Fights since the run last let up: N") rather than asking for the pitch
   * series to be read back and counted (finding 7).
   */
  release: {
    what: "A recovery room: low intensity, few bodies, room to breathe, and one round of fighting rather "
      + "than two. It is where mana and position get reset.",
    not_for: "A run that let up in the last fight or two, where letting up again leaves it with no shape "
      + "at all.",
  },
  build: {
    what: "Moderate intensity that keeps the run moving.",
    not_for: "A player who is one or two hearts from dying, or who has just been through a room that cost "
      + "them heavily. Nor a run that has gone several fights without letting up, where one more middling "
      + "room is the same room again.",
  },
  peak: {
    what: "The hardest room the run currently allows: the most bodies, the least room to breathe between "
      + "groups, and something in it to pick a kill order for.",
    not_for: "A player who is low on health, clearing slowly, or just out of a room that cost them "
      + "heavily; and a run that has not let up in several fights, where a hard room lands on a player "
      + "with nothing left to spend on it. (A peak never follows a peak, but code has already taken the "
      + "option away where that applies, so its presence here means it is allowed.)",
  },
};

export const SYMMETRY_SPEC: Readonly<Record<string, OptionSpec>> = {
  mirrored: {
    what: "A mirrored layout: both halves offer the same routes, so the room reads at a glance and a "
      + "player under pressure can plan without learning the floor first.",
    not_for: "A run whose last floor was already mirrored, and more so one that has been building mirrored "
      + "floors for several rooms together — a place made the same way every room stops reading as a place.",
    examples: [`${LAST_LOOK.layout}asymmetric`],
  },
  asymmetric: {
    what: "An asymmetric layout: harder to read, with one side holding more than the other, and the "
      + "variety a player who is coping can afford.",
    not_for: "A run whose last floor was already asymmetric, and more so one that has been building them "
      + "for several rooms together; or a player who is low and reading the floor under fire.",
    examples: [`${LAST_LOOK.layout}mirrored`],
  },
};

/**
 * **Also left as it was, and also on the measurement.** `standard` took 88% of
 * rooms with `compact` at 0%, and the parity rewrite — a narrower negative for
 * `compact`, a real one for `standard` — took standard to **100%** and lost
 * `vast` as well (18% → 0%). Size is stuck, and finding 26 says what the next
 * thing to try is; it is not another sentence.
 */
export const SIZE_SPEC: Readonly<Record<string, OptionSpec>> = {
  compact: {
    what: "A compact room, half again the view: the fight is found at once and the walk to it is short.",
    not_for: "A fight with room to spread out in, or a player with somewhere to retreat to.",
  },
  standard: {
    what: "A standard room, three quarters again the view: the fight has a middle, an approach and a way "
      + "round.",
    not_for: "A room with nothing in it — a vendor's, a fountain's — where the walk is the whole of it; "
      + "and an elite room, whose fight wants the floor to spread out over.",
  },
  vast: {
    what: "A vast room, twice the view: groups met one at a time, the longest fight and the longest walk.",
    not_for: "A player who is low — the walk is time under fire — or a room meant as a breather.",
  },
};

/**
 * The look-only questions. Both sides of each say what the look *buys*, so
 * neither is the safe one: measured with only the alternation to separate
 * them, brightness came back `bright` in 81% of rooms because `dim` had
 * nothing positive written on it and `bright` had legibility.
 */
export const MOOD_SPEC: Readonly<Record<string, OptionSpec>> = {
  cold: {
    what: "Cold light: a still, clinical room, and the deeper, older part of the place.",
    not_for: "A run whose last room was already cold, and more so one whose light has been cold for "
      + "several rooms together.",
    examples: [`${LAST_LOOK.light}warm`],
  },
  warm: {
    what: "Warm light: an active, lived-in room where something is still burning.",
    not_for: "A run whose last room was already warm, and more so one whose light has been warm for "
      + "several rooms together.",
    examples: [`${LAST_LOOK.light}cold`],
  },
  dim: {
    what: "Dim: the floor falls back and the lit things carry the eye — bullets, fire, the player's own "
      + "casts, the marks an enemy draws before it fires. It is the light most of this place is made of, "
      + "and the one that makes a bright room read as a change.",
    not_for: "A run whose last room was already dim, and more so one whose rooms have been dim for "
      + "several together.",
    examples: [`${LAST_LOOK.brightness}bright`],
  },
  bright: {
    what: "Bright: the whole floor is legible at once, hazards included. Nothing is hidden and nothing is "
      + "atmospheric.",
    not_for: "A run whose last room was already bright, and more so one whose rooms have been bright "
      + "for several together.",
    examples: [`${LAST_LOOK.brightness}dim`],
  },
  calm: {
    what: "Calm particles: nothing in the air competes with the enemy patterns.",
    not_for: "A run whose last room was already calm, and more so one whose air has been calm for "
      + "several rooms together.",
    examples: [`${LAST_LOOK.particles}busy`],
  },
  busy: {
    what: "Busy particles: the room feels alive, and slightly noisier to read.",
    not_for: "A run whose last room was already busy, and more so one whose air has been busy for several "
      + "rooms together; or a player already squeezed for room to move.",
    examples: [`${LAST_LOOK.particles}calm`],
  },
};

/** The one option every zone question carries besides its features. */
export const EMPTY_ZONE_SPEC: OptionSpec = {
  what: "Leave the zone empty: clean floor and one less thing for the player to read.",
  not_for: "A room that is already plain floor everywhere, where one more empty slot makes a room with "
    + "nothing in it.",
};

/* -------------------------------------------------- the generated options */

/*
 * **Three families of option are generated from a table**: the space
 * archetypes, the zone features and the variant bodies. Each used to be sent
 * as `{ what: <its own sentence> }` and nothing else — a spec with no negative
 * — and an option with nothing it is wrong for is the one every state falls
 * into. The negatives below are written from each item's **own data**: a
 * space's openness and cover, a feature's tags and hazard budget, a variant's
 * base and tags. Nothing here is tuned per room or per seed; if it were, it
 * would be the weight table with the numbers spelt out.
 */

/**
 * A space, and what its shape charges the player for. Both clauses come off
 * the two fields the mask fixes: openness is how much floor there is to dodge
 * on, cover is whether a firing line can be broken.
 */
export function spaceSpec(a: SpaceArchetype): OptionSpec {
  /*
   * Two clauses, and every archetype gets both, because an archetype with no
   * negative is the one every room falls into: `scattered_arena`, the only
   * mixed-and-sparse space and so the only one an earlier pass could find
   * nothing to say against, took 38% of rooms.
   *
   * The first clause is what the floor is like to move on. A tight room is
   * tight whatever its shape; a hall and a loop are held and circled rather
   * than crossed, so where the shape says more than the openness does, it
   * takes the slot.
   */
  const first =
    a.openness === "tight"
      ? "a player who is low or already squeezed for room to move: there is little clear floor to dodge "
        + "on, and a crowd has nowhere to be avoided"
    : a.shape === "ring"
      ? "a fight meant to be shot across: the core is in the way of every line through the middle, so a "
        + "body on the far arc cannot be answered at all"
    : a.shape === "corridor"
      ? "a fight the player needs to circle out of: a hall is held from its ends or not at all, and "
        + "whatever is walking up it is walking at them"
    : a.openness === "mixed"
      ? "a fight that wants the floor to be one thing or the other: there is cover in it and room around "
        + "the cover, so it neither opens the room up nor closes it down"
      : "a fight meant to close in: with the floor clear from end to end there is always somewhere to "
        + "step, so a crowd presses rather than traps";
  /* The second is whether a firing line can be broken, which is the cover. */
  const second =
    a.cover === "dense"
      ? "a build that needs a clear line to what it is shooting at: a shot stops on the cover as often "
        + "as on a body"
    : a.cover === "sparse"
      ? "a player who needs somewhere to be: the pillars break a line for a moment and hide nobody behind "
        + "them"
      : "a player being shot from across the room: there is nothing here to put between themselves and it";
  return { what: a.description, not_for: sentence(`${first}; and ${second}`) };
}

/**
 * A zone feature, and what putting it in a slot costs. From the tags and the
 * hazard budget, both of which the feature table already carries for the
 * hazard accounting.
 */
export function featureSpec(f: Feature): OptionSpec {
  const tags = new Set(f.tags);
  const clauses: string[] = [];
  if (tags.has("damage_zone"))
    clauses.push("a player who is low, or one whose last rooms went badly: this takes health for standing "
      + "in the wrong place, on top of whatever the fight is already taking");
  if (tags.has("movement_pressure") && !tags.has("damage_zone"))
    clauses.push("a player already spending the fight moving: it charges again for the floor they are "
      + "using to get out of the way");
  if (tags.has("area_denial"))
    clauses.push("a room that needs its floor: this takes a piece of it out of the fight for as long as "
      + "the fight lasts");
  if (tags.has("ranged_pressure"))
    clauses.push("a room already answering shooters, where one more source of fire that never moves is "
      + "more of the same question");
  if (tags.has("cover"))
    clauses.push("a room already thick with cover, where one more solid thing is another line nobody can "
      + "hold and another body to lose sight of");
  if (f.hazard_budget >= 2)
    clauses.push(`a room whose hazard allowance is nearly spent: this one costs ${f.hazard_budget} of it`);
  /*
   * A feature every clause above misses still gets one: an option with
   * nothing it is wrong for is the one every slot falls into, and `none` is
   * on every slot's list to be chosen on its merits rather than by default.
   * Every feature in the table today matches a clause; this is the floor
   * under the next one added.
   */
  if (clauses.length === 0)
    clauses.push("a room whose floor is already the fight: this is one more thing on it to read");
  return { what: f.description, not_for: sentence(clauses.slice(0, 2).join("; and ")) };
}

/**
 * A variant body, and where it is the wrong variant. Two facts, both from the
 * enemy table: the body it varies, which is what the player reads the change
 * against, and the tags, which say which kind of pressure it adds more of.
 */
export function subspeciesSpec(input: {
  readonly description: string;
  readonly base: string;
  readonly tags: readonly string[];
  readonly threat: number;
}): OptionSpec {
  const tags = new Set(input.tags);
  /*
   * **The base is a fact about the option, not a reason against it.**
   *
   * It used to open the negative: "not for a room the player meets no
   * ordinary <base> in". True of nearly every option of nearly every room —
   * the roster is decided in the round after this one, so *no* variant can be
   * promised its base — which made it a sentence written on the whole pool.
   * Finding 2's converse: where every option is wrong for the state, nothing
   * fits and the escape option takes the answer. Measured, this ranking
   * declined 15% of the time, at 0.21 on the escape.
   *
   * So the base moves into `what`, where it is the useful half of it (a
   * variant is only legible as a change to the body it changes), and the
   * negative is written from the tags alone — which differ between the
   * options, and so tell them apart.
   */
  const clauses: string[] = [];
  if (tags.has("melee_heavy"))
    clauses.push("a player losing most of their health to blades");
  else if (tags.has("ranged_heavy"))
    clauses.push("a player being shot to pieces from across the room");
  if (tags.has("movement_pressure"))
    clauses.push("a player squeezed for room to move");
  else if (tags.has("area_denial"))
    clauses.push("a room whose floor is given over to hazards");
  else if (tags.has("ranged_pressure"))
    clauses.push("a room that is answering fire from every side of it");
  if (input.threat >= 5)
    clauses.push("a room meant as a breather: this is among the heaviest bodies in the game");
  // The floor, for a variant whose tags say none of the above: the body it
  // varies, which at least differs between the options of one slate.
  if (clauses.length === 0)
    clauses.push(`a room built round the ${input.base} already, where the same body read twice is one question`);
  return {
    what: `${input.description} A variant of the ${input.base}, so it reads as one until it does not.`,
    not_for: sentence(clauses.slice(0, 2).join("; and ")),
  };
}

/**
 * **What a card is not for, from the card's own table row.**
 *
 * This used to be written from the *facts the pool tagged the card with*, and
 * two cases of those, so most of a spell offer arrived with no negative at all
 * — which is finding 2 on the largest option list the Director sends: an
 * option with nothing it is wrong for is the one every state falls into, and a
 * pool of twenty-five of them is twenty-five sinks.
 *
 * So the negative comes off the content tables instead, as it does for a
 * space, a zone feature and a variant body: a spell's shape, spread, range tag,
 * element and mana cost; an affix's lane; a stat's family. Nothing here is
 * tuned per room or per seed — the same card carries the same negative all run
 * — and every clause names something that **differs between the options**,
 * which is what finding 18 says a negative has to do to be worth sending.
 *
 * The pool's own facts keep one case, because it is sharper than anything the
 * table says: a card whose single claim is that it raises something already
 * held.
 */
export function cardNotFor(id: string, facts: readonly string[], discriminating: boolean): string | undefined {
  const claims = facts.filter((f) => CARD_CLAIMS.has(f));
  if (claims.length === 1 && claims[0] === "upgrade")
    return "A staff with an empty key: the copy raises what is already held, and the empty key stays "
      + "empty.";
  const own = cardOwnNegative(id);
  if (own) return own;
  /*
   * Only for an id no content table knows, which is a fixture's. The sentence
   * is true of the whole pool where the pool tags nothing, so it is sent only
   * where the cards it applies to are the minority (`discriminating`).
   */
  return claims.length === 0 && discriminating
    ? "This card is not on the style the player stated, covers no role the staff is missing, eases "
      + "nothing the last fights were shortest of, carries no element the keys already build, and "
      + "raises nothing already held. It is here on its own merits alone."
    : undefined;
}

/**
 * A card's negative from whichever table holds it: the affix roster, the stat
 * table, or the spell pool.
 *
 * An affix takes its **lane's** negative and a stat its **family's** — the two
 * groupings the game already has, each with one written limit, so twenty
 * affixes carry six distinct negatives and twelve stats carry four, rather
 * than thirty-two sentences invented one at a time.
 */
function cardOwnNegative(id: string): string | undefined {
  const affix = spellAffixById(id);
  if (affix) {
    const lane = laneOf(id);
    return lane ? LANE_SPEC[lane].not_for : undefined;
  }
  const stat = statById(id);
  if (stat) return FAMILY_SPEC[stat.family]?.not_for;
  const item = ITEMS.get(id);
  return item ? spellNegative(item) : undefined;
}

/**
 * **Where a spell is the wrong spell**, in two clauses off its own parameters:
 * what the cast covers (its option, its shape, or how many projectiles it
 * makes), and what it asks of the fight (the range it is tagged with, the
 * status it carries, or that it carries none).
 *
 * Every clause names an objective situation in which the cast does little and
 * says why, from the params — never that the spell is weak, and never how it
 * compares with the rest of the pool (doc 006, "What a spell tells Jev").
 * `spell-text.test.ts` renders it for every item and sweeps it for digits and
 * verdict words.
 */
export function spellNegative(item: BaseItem): string {
  const p = item.params as Record<string, unknown>;
  const shape = typeof p["shape"] === "string" ? p["shape"] : "bolt";
  const count = typeof p["count"] === "number" ? p["count"] : 1;
  const element = typeof p["element"] === "string" && p["element"] !== "none" ? p["element"] : null;
  /*
   * Doc 006's options come first where a spell has one: each changes what
   * the key asks of the fight more than its shape does, and each names the
   * situation in which that ask goes unanswered. Then the thirteen shapes,
   * and last the bolt read by what it throws: a shot that chains or pierces
   * reaches several bodies whatever its count, so it is read apart from the
   * single shots — an option that misdescribes its own contents is worse than
   * one with no text at all (finding 11).
   */
  const pattern = typeof p["pattern"] === "string" ? p["pattern"] : "";
  const covers =
    num(p, "charge") > 0
      ? "a fight that gives no pause to charge in: a shot let go early is a fraction of itself"
    : num(p, "charges") > 0
      /*
       * Not "a key pressed without rest": pressing on every charge is this
       * option's highest damage a second (doc 006), so that clause named the
       * way of playing it that deals the most as the way it does little, and
       * it named the Barrage verb besides — Mana Darts went to a Barrage run
       * in none of six offers (jev-findings 28). What pressing on every
       * charge costs is mana, and that is the situation it is wrong in.
       */
      ? "a bar running dry: each press costs a whole cast, however few darts are banked"
    : num(p, "doom") > 0
      ? "bodies that die before the mark bursts: the burst is most of what the cast deals"
    : num(p, "contagion") > 0
      ? "bodies that are not dying near one another: the poison jumps only from a death"
    : num(p, "emit") > 0
      ? "one body standing still: most of the shards fly past it"
    : num(p, "telegraph_ms") > 0
      ? "bodies that keep moving: the ground is marked before the hit lands"
    : num(p, "land") > 0
      ? "a body whose attacks land at arm's length: the leap comes down beside it"
    : num(p, "collapse_damage") > 0
      ? "bodies that leave the pull before it ends: the implosion hits only what is still inside"
    : pattern === "ring"
      ? "bodies spread across the room: the rings reach a few tiles from the caster and no further"
    : shape === "trail"
      ? "a fight held in one spot: the ground is laid only where the player walks"
    : shape === "enchant"
      ? "a fight the sword cannot reach: the waves leave only from a swing"
    : shape === "stance"
      ? "bodies that are not attacking the player: the full answer needs a hit to take"
    : shape === "orb"
      ? "bodies that leave the orb's reach: it strikes only what drifts within it"
    : shape === "boomerang"
      ? "a body beyond the throw's reach: the blade turns short of it"
    : shape === "field" || shape === "vortex"
      ? "a fight that keeps moving: what it puts on the floor pays only while a body stands in it"
    : shape === "pillar"
      ? "a room the player has to keep crossing: it holds one place and follows them nowhere"
    : shape === "summon"
      ? "a room that is over quickly, where the companion arrives for the end of it"
    : shape === "dash"
      ? "a body out of the dash's short reach: it cuts only what it passes through"
    : shape === "orbit"
      ? "a fight answered from range: it strikes only what comes to the player"
    : shape === "eruption"
      ? "bodies that keep moving: the cells go off after a windup, a beat apart"
    : num(p, "chain") > 0
      ? "a lone body: the jumps have no second body to reach"
    : count > 1 && num(p, "spread") >= 180
      ? "bodies at range: the ring of shards stops a short way from the caster"
    : count > 1 && num(p, "seek") > 0
      ? "a crowd with one body to kill first: each dart turns onto whichever body is nearest"
    : count > 1
      ? "one body at a distance: the spread lands a fraction of itself on it"
    : num(p, "pierce") > 0
      ? "a lone body: the shot passes through it with nothing behind"
      : "a crowd: one projectile answers one body";
  const asks =
    item.tags.includes("short")
      ? "bodies that keep their distance: its range is short"
    : item.tags.includes("long")
      ? "a fight held at sword range, where the cast has no room to travel"
    : element
      ? `a staff whose keys already carry ${element}: its hits fill the same ${GAUGE[element] ?? element} `
        + "gauge the other key fills"
      : "a build that puts a status on every body: it carries no element and fills no gauge";
  return sentence(`${covers}; and ${asks}`);
}

/** The gauge each element fills on a body. */
const GAUGE: Readonly<Record<string, string>> = { fire: "burn", ice: "chill", poison: "poison" };

/**
 * Whether the "answers nothing in particular" negative says anything about
 * *this* pool: it does when the cards it applies to are the minority.
 */
export function cardNegativesDiscriminate(
  candidates: readonly { readonly facts: readonly string[] }[],
): boolean {
  const bare = candidates.filter((c) => !c.facts.some((f) => CARD_CLAIMS.has(f))).length;
  return bare * 2 <= candidates.length;
}

const CARD_CLAIMS: ReadonlySet<string> = new Set(["style", "need", "eases", "synergy", "upgrade"]);

/** A numeric spell parameter, or zero where the spell has none. */
function num(p: Record<string, unknown>, key: string): number {
  return typeof p[key] === "number" ? (p[key] as number) : 0;
}

/** A clause list as a sentence: capitalised, stopped. */
function sentence(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
