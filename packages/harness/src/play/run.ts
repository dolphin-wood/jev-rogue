import { liveCount } from "@jr/core";
/**
 * Plays a whole run headless: the Director plans, the reference player fights,
 * and the result is the same simulation the browser runs. This is what makes
 * "the balance harness runs the game, not a model of it" true rather than a
 * claim (design docs 008, 011).
 */
import {
  MAX_HEARTS, RngSource, bucketClearSpeed, bucketGold, bucketHealth, SMITH_PRICE, MERCHANT_PRICE, fountainDrink, fountainWouldHeal,
  bucketMovementPressure, bucketRecentDamage, bucketRunProgress, createWorld,
  plainInstance, heldDominantTags, STYLE_START, step, worldCleared, ITEMS, STEP_MS,
  RUN_BOSS_ROOM, stageFor, applyStat, cardPool, cardsFor, cardNeedsFor, portalChoices, heldSpell, CARDS_PER_OFFER, equipItem, attachAffix, withLevel,
  noMods, AFFIX_SLOTS, generateRoom, toRoomPlan, BOSS_ARCHETYPES,
  buildShapeFor, expectedClearMsFor, goldRoomCoins, COIN_VALUE, COIN_BOOST_MAX, affixFitsHeld, fixedExit,
  levelAt, withLevels,
  observedFigures,
  bucketConsistency, cardStyleTags, measureOf, observedLabels, UNMEASURED,
  makeEnemy, GRID_W, GRID_H, TILE_PX, runStaff, SPELL_LEVEL_MAX, slotCost, affixFitsSpell, spellAffixById, journalDoor, cardTypesOf,
} from "@jr/core";
import type {
  Archetype, ItemInstance, RoomType, JournalDoor, RunContext, RunHistory, RunJournalEntry, Staff, Tension, World,
  PlayerMods, RewardCardKind, DoorOffer, OfferCard, AttachedAffix,
} from "@jr/core";
import { createDirector } from "@jr/director";
import type { CardRequest, DirectorArm, DirectorDeps, OfferRequest } from "@jr/director";
import { referenceInput, lastDecision, lastPlan } from "./player-model.ts";
import { SKILL_PROFILES } from "./skill.ts";
import type { SkillProfile } from "./skill.ts";
import { HP_PER_HEART, NEAR_BULLET_PX, emptyRoom } from "./playtest-log.ts";
import type { RoomLog } from "./playtest-log.ts";
import { hasLineOfSight, circleHitsWall, ENEMIES, rampMinimum } from "@jr/core";

const ROOM_TIMEOUT_MS = 120_000;
/** Doc 003 budgets the boss at two to three minutes; a two-minute clock would call a fight on budget a failure. */
export const BOSS_TIMEOUT_MS = 240_000;

/** Hearts lost by cause, across every room of every run in this process. */
export const HURT_BY = new Map<string, number>();
/**
 * The mana economy across every fight: how long the bar sat below the
 * cheapest key's cost (the player could cast nothing), how often a spell
 * press was refused for mana, and the mean fill. "Does mana ever run out" is
 * answered by the first number, not by feel.
 */
export const MANA = { ms: 0, starvedMs: 0, fillSum: 0, samples: 0, presses: 0, refused: 0 };
/** Waves per fight: the opening arrival plus each pending wave, by room type. */
export const WAVES = new Map<string, number[]>();
/**
 * How crowded the air is: enemy bullets alive and bodies holding a turn to
 * attack, sampled every step of every combat room. What "too dense" means,
 * measured, so a change to the caps can be judged by more than hearts.
 */
export const DENSITY = { samples: 0, bullets: 0, peakBullets: 0, attackers: 0, over30: 0 };
/**
 * **How the fight is spread over a room**, sampled every step of every
 * uncleared combat room (doc 005, "Stations").
 *
 * The complaint this measures is "the map is either full of enemies or
 * empty". Two numbers say it: the share of a room's time with **nothing
 * awake in view**, which is the player walking through a hall, and the share
 * with **more than six in view**, which is the knot. Both should be small;
 * everything between them is a fight the player can see the shape of.
 *
 * "In view" is the viewport the world already measures bodies against
 * (`World.viewHalf`), so it means the same thing here as it does to the
 * firing rules.
 */
export const VIEW = {
  samples: 0, empty: 0, crowded: 0, inView: 0, peak: 0,
  /** Of the empty samples, what was keeping the fight off the screen. */
  occluded: 0, unfound: 0, gate: 0, commute: 0, stragglers: 0, other: 0,
};
/**
 * **What an awake body is doing**, sampled every step of every uncleared
 * combat room and totalled by archetype (doc 005, the token budget).
 *
 * The complaint this measures is "enemies wander about for ages doing
 * nothing". A room holds two attack turns and two firing turns, so with five
 * or six bodies awake most of them are, by design, not attacking — and the
 * question is whether what they do instead reads as waiting for an opening or
 * as standing around. `idle` is the share that is neither attacking nor
 * making a visible threat move, and it is the number to drive down.
 */
export const STATES = new Map<string, Record<string, number>>();
/**
 * Hearts lost and room length **by room index** (doc 005, the ramp). A band
 * average hides the shape of a run: the question the ramp answers is whether
 * the opening rooms are visibly easy and the curve climbs, and only an index
 * can show that.
 */
export const BY_INDEX = new Map<number, { rooms: number; hearts: number; ms: number; bodies: number }>();
/**
 * Combat and elite rooms that spawned fewer bodies than the ramp's minimum.
 *
 * The player walked into a fight room with nothing in it. The world
 * guarantees the floor now (`rampMinimum`); this is the assertion that says
 * so over a whole run, because the guarantee is worth exactly as much as the
 * thing that keeps checking it.
 */
export const THIN_ROOMS: { seed: string; index: number; spawned: number; least: number }[] = [];
/**
 * **How each held spell was used**, by spell id, across every fight of every
 * run in this process: the seconds it sat on a key, how often the key went
 * off, and the spell's share of the damage in the rooms it was held in.
 *
 * A spell that is held and never cast measures nothing about the spell and
 * everything about the hands, and a run's outcome cannot tell the two apart;
 * this can. A cast is counted when its key's cooldown starts, its bank
 * empties or its charge is let go. The `solo` figures are the fights where
 * it was the only spell on the staff — a starter's opening rooms — which is
 * the one place a spell's damage in a real room can be told from the rest.
 */
export const SPELL_USE = new Map<string, {
  heldMs: number; casts: number; roomDamage: number; swordDamage: number;
  soloMs: number; soloCasts: number; soloSpellDamage: number; soloSwordDamage: number; soloKills: number; soloHearts: number;
}>();
const noUse = () => ({
  heldMs: 0, casts: 0, roomDamage: 0, swordDamage: 0,
  soloMs: 0, soloCasts: 0, soloSpellDamage: 0, soloSwordDamage: 0, soloKills: 0, soloHearts: 0,
});
export const STATE_KEYS = ["attacking", "closing", "wait_melee", "wait_fire", "reposition", "silenced", "stunned", "other"] as const;
/** How recently a body must have made a readable move to count as busy. */
const THREAT_SEEN_MS = 1200;

/** More than this many awake bodies in the view at once is a crowd. */
const VIEW_CROWD = 6;
/** Bodies left at or under which the room counts as down to its stragglers. */
const STRAGGLERS = 2;
/** Experiment knobs for the firing caps (`JR_FIRE_TOKENS`, `JR_FLIGHT`); the defaults when unset. */
const knob = (name: string): number | undefined => (process.env[name] ? Number(process.env[name]) : undefined);

/** Where each melee hit landed, when `JR_MELEE=1`. See the push site below. */
export const MELEE_HITS: {
  cause: string; dist: number; radius: number; phase: string; reach: number; offAxisDeg: number;
  /**
   * What the model knew when it chose the step it was standing on. `saw` is
   * whether this body's attack was already visible at plan time; `planAgeMs` is
   * how stale the commitment was. Together they separate "stood too close" from
   * "never saw it" from "saw it and was mid-dodge", which is otherwise guesswork.
   */
  saw: boolean; planAgeMs: number;
}[] = [];

export interface RoomOutcome {
  readonly index: number;
  readonly type: RoomType;
  readonly space: string;
  readonly tension: Tension;
  /**
   * The look-only answers, so the route review can report their spread on
   * both arms. Four of them were 91% to 100% one answer on the live model and
   * nothing in the harness could see it, because the route printed the space
   * and not the room.
   */
  readonly symmetry: string;
  readonly mood: { temperature: string; brightness: string; particles: string };
  /** Each held key's level as this room was planned, for the levelling curve. */
  readonly levels: readonly number[];
  readonly cleared: boolean;
  readonly heartsLost: number;
  readonly ms: number;
  readonly enemies: number;
  /** How the fight was built: the profile's density and staging plus roster size. */
  readonly shape: { density: string; waves: string; roster: number; anchor: string } | null;
  /** What the portal into this room promised: the currency, or null for the merchant and boss. */
  readonly rewardKind: RewardCardKind | null;
  /** What was actually taken, as a card label, or null. */
  readonly reward: string | null;
  readonly sources: string[];
  /**
   * **The route, as the player saw it** (`pnpm route-review`).
   *
   * Pass rates and band averages say whether a run was survivable; they say
   * nothing about whether the doors and cards in front of the player made
   * sense to them, which is what the offer is for. So each room records the
   * portal it was entered through, the portals it offered on the way out, the
   * cards on its reward screen, the build at that moment and the handful of
   * labels the offer was grounded on — enough to read a whole run back and
   * judge each offer against what the player actually had.
   */
  readonly route: RouteRecord;
}

/** One room's offer, for the route review. */
export interface RouteRecord {
  /** The portal walked through to get here, as a short word. */
  readonly doorIn: string;
  /** The portals offered on the way out. */
  readonly portalsOut: readonly string[];
  /** The cards on this room's reward screen. */
  readonly cards: readonly string[];
  /** The keys held when the offer was planned, with level and affixes. */
  readonly build: readonly string[];
  /** The labels the door and card options are grounded on. */
  readonly labels: Readonly<Record<string, string>>;
  /**
   * Cards on this room's screen that **no held key can take** — an affix whose
   * shape, projectile count or slot rule refuses every spell the player has.
   * Reported from play as the scatter build being offered Seek over and over.
   */
  readonly dead: readonly string[];
}

/** Which family took the most health this room, as `observed.ts` names them. */
function hurtFamilyOf(stats: { hurtByRanged: number; hurtByMelee: number; hurtByHazard: number }): string {
  const worst = ([["shots", stats.hurtByRanged], ["blades", stats.hurtByMelee], ["hazards", stats.hurtByHazard]] as const)
    .reduce((a, b) => (b[1] > a[1] ? b : a));
  return worst[1] > 0 ? worst[0] : "nothing";
}

/** A door as one short word, for the route review. */
export function doorWord(d: DoorOffer): string {
  // A door the run's shape fixed promises the room ahead, not a currency.
  if (d.onward) return "onward";
  if (d.npc) return d.npc;
  const types = (d.schools ?? d.families ?? []).join("/");
  return `${d.difficulty === "elite" ? "ELITE " : ""}${d.reward}${types ? `:${types}` : ""}${(d.grade ?? 1) > 1 ? `x${d.grade}` : ""}`;
}

export interface RunOutcome {
  readonly seed: string;
  readonly arm: DirectorArm;
  readonly rooms: readonly RoomOutcome[];
  /**
   * The same run as a playtest log, in the shape the browser writes when a
   * person plays (`playtest-log.ts`). Kept beside `rooms` rather than folded
   * into it because the two answer different questions: `rooms` is what the
   * Director planned, `log` is what the fight cost.
   */
  readonly log: readonly RoomLog[];
  /** Which skill profile played it. */
  readonly profile: string;
  readonly survived: boolean;
  readonly heartsLeft: number;
  readonly totalMs: number;
  readonly items: readonly string[];
  /**
   * The build the run reached the boss with, or null if it died first: each
   * key's spell with its level and affix tiers, how many stat cards it took,
   * and its health. What "a mature build" means, measured (task 10).
   */
  readonly atBoss: {
    readonly spells: readonly { id: string; level: number; affixes: readonly string[] }[];
    readonly stats: number;
    readonly hearts: number;
    readonly gold: number;
    /** The body's level on entering the boss room (`run/levels.ts`). */
    readonly level: number;
  } | null;
  /**
   * The fountains this run met (doc 003): how many portals offered one, how
   * many of those rooms it entered, and how many drinks it actually took —
   * which includes the one at the vendors' stop and excludes any refused for
   * a full bar.
   */
  readonly fountains: { readonly offered: number; readonly taken: number; readonly drunk: number };
  /** What each fight measured, for calibrating the observed labels (doc 010). */
  readonly measures: readonly ReturnType<typeof measureOf>[];
}

export async function playRun(
  seed: string, arm: DirectorArm, preset: Archetype = "spam", deps: DirectorDeps = {},
  /**
   * The player's typed intent (doc 007), which the Director reads as design
   * intent. The harness had no way to set it, so the one Director input a
   * player writes in their own words was never measured.
   */
  freeText?: string,
  /**
   * How well the reference player plays (`skill.ts`). `expert` is the model as
   * it was before profiles existed, so every published number reproduces under
   * the default and only a caller that asks gets a weaker player.
   */
  profile: SkillProfile = SKILL_PROFILES.expert,
): Promise<RunOutcome> {
  const director = createDirector(arm, deps);
  const src = new RngSource(seed);
  const staff: Staff = runStaff();

  // One spell to start, as the scene does: the style's own, on the first key.
  let slots: (ItemInstance | null)[] = Array.from({ length: staff.slots }, (_, i) =>
    i === 0 ? plainInstance(STYLE_START[preset]) : null);
  const inventory: ItemInstance[] = [];
  let hearts = MAX_HEARTS;
  let gold = 0;
  const rooms: RoomOutcome[] = [];
  /** The run as a playtest log, in the shape the browser writes (`playtest-log.ts`). */
  const log: RoomLog[] = [];
  // RunHistory is readonly by design; the run owns mutable copies and hands
  // the Director a frozen view each room.
  const rooms_: RoomType[] = [];
  const tensions_: Tension[] = [];
  const spaces_: string[] = [];
  const skeletons_: string[] = [];
  const profiles_: NonNullable<Awaited<ReturnType<typeof director.planRoom>>["profile"]>[] = [];
  const scores_: RunHistory["counter_scores"][number][] = [];
  /** Hearts lost per room, in room order, for `damage_trend` (doc 002). */
  const heartsLost_: number[] = [];
  /*
   * **What the doors offered and what the player did with them**, and what the
   * rooms looked like. The Director answers each room from that room's labels,
   * so without these it could not see that it had put the same badge in front
   * of the player six rooms running, or built six rooms the same colour.
   */
  const doorsOffered_: string[][] = [];
  const doorsTaken_: string[] = [];
  const moods_: RunHistory["moods"] extends readonly (infer M)[] | undefined ? M[] : never[] = [];
  const symmetries_: ("mirrored" | "asymmetric")[] = [];
  const statsTaken_: string[] = [];
  /**
   * **The run written down room by room**, for the Director's briefing. The
   * arrays above are each one fact per room, sliced apart for a label
   * function; this is them back together, one entry a room.
   */
  const journal_: RunJournalEntry[] = [];
  const history = (): RunHistory => ({
    rooms: rooms_, tensions: tensions_, profiles: profiles_, hearts_lost: heartsLost_,
    spaces: spaces_ as RunHistory["spaces"], skeletons: skeletons_, counter_scores: scores_,
    doors_offered: doorsOffered_, doors_taken: doorsTaken_,
    moods: moods_, symmetries: symmetries_, stats_taken: statsTaken_, journal: journal_,
    shop_entered: rooms_.includes("shop"),
    rests_entered: rooms_.filter((r) => r === "rest").length,
    // No treasure rooms exist any more (doc 003); the field is kept for the type.
    treasures_entered: 0,
    elite_last_room: rooms_.at(-1) === "elite", shielded_rooms: 0,
  });
  let lastClearMs = 30_000;
  /** Every cleared fight's length, for the pace `clear_speed` is read against. */
  const clearedMs: number[] = [];
  /** The share of the last fight spent with an enemy bullet close (doc 011). */
  let nearShare = 0;
  /** The style tags of every card taken, for revealed preference (doc 007). */
  const pickTags: string[][] = [];
  /** What each fight measured, for the observed labels (`run/observed.ts`). */
  const measures: ReturnType<typeof measureOf>[] = [];
  let heartsLostRecent = 0;
  let totalMs = 0;
  /** Only the first room's suggestion; from then on the room decides its own. */
  const tension: Tension = "build";
  /*
   * **The same run shape the browser plays.** Doc 003 collapsed room types:
   * every room before the merchant is a fight, and what a portal promises is a
   * currency and a difficulty. The harness used to walk the old six types and
   * spent three of nine rooms at zero kills and zero seconds, so every pacing
   * number it produced described a structure the game no longer had.
   *
   * What the run owns is held here and handed into each room, exactly as the
   * scene does: modifiers, the staff, and the affixes on each spell. The world
   * is rebuilt every room and would otherwise forget all three.
   */
  let mods: PlayerMods = noMods();
  /*
   * **Experience and the level it buys** (`run/levels.ts`), carried between
   * rooms exactly as gold, rage and the modifiers are. The world earns it and
   * spends it; the run only remembers the total, and `createWorld` folds the
   * level into the body every room. That is the parity rule: the browser does
   * the same two lines, so a harness run and a played run level identically.
   */
  let xp = 0;
  /** The stat cards' modifiers with the level's share folded in, as the world builds them. */
  const liveMods = (): PlayerMods => withLevels(mods, levelAt(xp).level);
  let statsTaken = 0;
  let atBoss: RunOutcome["atBoss"] = null;
  const spellAffixes: (readonly AttachedAffix[])[] = [];
  const owned: string[] = slots.flatMap((x) => (x ? [x.base] : []));
  let door: DoorOffer = { reward: "spell", difficulty: "normal", grade: 1 };
  const spellLevels: number[] = [];
  /**
   * The rooms with no fight in them this run, as `portalChoices` counts them:
   * vendors and fountains apart, and whether the room just left was one.
   */
  let npcRooms = 0;
  /** Elite rooms entered, and ordinary fights since the last (`legalDifficulties`). */
  let eliteRooms = 0;
  let fightsSinceElite: number | undefined = undefined;
  /** Vendor portals put on the list this run, met or declined (`NPC_OFFERS_MAX`). */
  let npcOffers = 0;
  let fountains = 0;
  let lastWasNpc = false;
  /** How often a fountain was on offer, and how many drinks the run actually took. */
  let fountainsOffered = 0;
  /** The same count as `portalChoices` reads it (`FOUNTAIN_OFFERS_MAX`). */
  let fountainOffers = 0;
  let fountainsDrunk = 0;
  // Doc 007's pity and temptation clocks, as the scene keeps them.
  let offersMade = 0;
  // Spin charges carry through a portal, as in the scene.
  let rage = 0;
  let needMisses = 0;

  /** The keys as the offer reads them: each held spell and what is attached to it. */
  const heldNow = () => slots.flatMap((x, i) =>
    (x ? [heldSpell(ITEMS.get(x.base), (spellAffixes[i] ?? []).map((a) => a.id))] : []));
  /** The same facts the scene reads (task 9). */
  const needsFor = (c: RunContext) => cardNeedsFor(
    c.labels, preset,
    slots.flatMap((x, i) => (x ? [{ base: x.base, affixes: spellAffixes[i] ?? [] }] : [])), ITEMS,
  );
  // As in the scene: a held spell below the cap stays offerable, a copy levels it.
  const ownedFor = (k: RewardCardKind): string[] => k === "spell"
    ? slots.flatMap((x, i) => (x && (spellLevels[i] ?? 1) >= SPELL_LEVEL_MAX ? [x.base] : []))
    : owned;
  /** The run as the Director reads it at this moment. */
  const contextNow = (index: number): RunContext => context(
    seed, index, hearts, gold, staff, slots, inventory, history(), preset, lastClearMs, heartsLostRecent,
    pickTags, clearedMs, nearShare, measures,
    freeText, { levels: spellLevels, affixes: spellAffixes, mods: liveMods() }, xp,
  );

  /**
   * **The doors out of a room, decided once its reward is taken**, as the
   * scene decides them while the portals turn: one request carries the
   * portal questions and, for each kind a portal could be, the cards the room
   * behind it will offer. A door keeps its kind's cards and is badged with
   * every school or family among them (`cardTypesOf`); the rest are unused.
   */
  async function openPortals(index: number, elite: boolean): Promise<DoorOffer[]> {
    const ctx = contextNow(index);
    const held = heldNow();
    const needs = needsFor(ctx);
    const choices = portalChoices(
      {
        roomIndex: index,
        /*
         * **This room's own difficulty.** These portals decide the next
         * room, so "no elite after an elite" is about the room the player
         * is standing in. It used to be the room before it, and a run
         * could come back with two elites in a row.
         */
        lastWasElite: elite,
        elitesSoFar: eliteRooms,
        ...(fightsSinceElite === undefined ? {} : { fightsSinceElite }),
        critical: hearts <= 1, style: preset,
        // The same hard rules the scene applies: no second room without a
        // fight straight after one, and one fountain a run.
        npcRooms, fountains, lastWasNpc, npcOffers, fountainOffers,
        hurt: hearts < MAX_HEARTS + liveMods().maxHearts,
      },
      src.stream("portal-count", index),
    );
    const kinds = ["spell", "affix", "stat"] as const;
    const cards: CardRequest[] = kinds.map((k) => ({
      room_index: index + 1, pool: cardPool(ITEMS, ownedFor(k), k, held, { style: preset }, needs),
      count: CARDS_PER_OFFER, pity: needMisses >= 3, temptation: offersMade % 4 === 3, salt: `door_${k}`,
    }));
    const plan = await director.planOffer(ctx, { portals: choices, cards });
    return (plan.portals?.doors ?? []).map((d) => {
      if (d.npc || d.reward === "gold") return d;
      const ids = plan.cards[kinds.indexOf(d.reward as (typeof kinds)[number])]?.ids ?? [];
      return ids.length ? { ...d, ...cardTypesOf(d.reward, ids), cards: ids } : d;
    });
  }

  /*
   * `JR_ROOMS=<n>` ends the run after its first n rooms: the opening rooms
   * are where a style's starter is the whole staff, and a study of them
   * should not pay for the other fourteen.
   */
  const lastRoom = Math.min(RUN_BOSS_ROOM, knob("JR_ROOMS") ?? RUN_BOSS_ROOM);
  for (let index = 1; index <= lastRoom && hearts > 0; index++) {
    const stage = stageFor(index);
    /*
     * A portal can lead to **the fountain** instead of a fight (doc 003).
     * There is no encounter in that room, so the harness treats it the way it
     * treats the vendors' stop — no fight, no reward, one drink — and the
     * balance numbers then include the health it gives back, which is the
     * whole reason for teaching the reference player to take it.
     */
    const fountainRoom = stage === "combat" && door.npc === "fountain";
    /*
     * A vendor's room is not a fight either, which the harness used to miss:
     * only the fountain was handled, so a smith door led to an ordinary fight
     * with a blacksmith's badge on it. It never showed, because the reference
     * player declined every vendor; it shows now that it takes the smith.
     */
    const vendorRoom = stage === "combat" && (door.npc === "smith" || door.npc === "merchant");
    // Counted on entry, not on the way out, because the portals out of this
    // room are decided below and must already know what this room is.
    if (fountainRoom) fountains++;
    else if (vendorRoom) npcRooms++;
    lastWasNpc = fountainRoom || vendorRoom;
    const isFight = stage === "combat" && !fountainRoom && !vendorRoom;
    const elite = isFight && door.difficulty === "elite";
    // The elite spacing, counted on entry: the portals decided below have to
    // already know where this room stands (`ELITE_GAP_FIGHTS`).
    if (elite) { eliteRooms++; fightsSinceElite = 0; }
    else if (fightsSinceElite !== undefined && isFight) fightsSinceElite++;
    const roomType: RoomType = isFight ? (elite ? "elite" : "combat") : stage === "boss" ? "boss" : "shop";
    const ctx = context(
      seed, index, hearts, gold, staff, slots, inventory, history(), preset, lastClearMs, heartsLostRecent,
      pickTags,
      clearedMs, nearShare, measures,
      freeText, { levels: spellLevels, affixes: spellAffixes, mods: liveMods() }, xp,
    );

    /*
     * **This room's cards came with the door.** They were decided when the
     * door opened, at the end of the room before, against the build the player
     * walked through it with (`openPortals` below). Only a door that brought
     * none — the run's first room, or a door the fallback made — asks for them
     * here, riding in the room's round 1 as they always did. The merchant
     * stocks one card of each kind; the boss room offers nothing.
     */
    const offerKind: RewardCardKind | null =
      isFight ? door.reward : stage === "shop" ? "stat" : null;
    const held = heldNow();
    const needs = needsFor(ctx);
    const promise = isFight ? { grade: door.grade, style: preset } : {};
    const decidedCards = isFight && door.reward !== "gold" ? door.cards : undefined;
    const cardReqs: CardRequest[] = [];
    if (isFight && door.reward !== "gold" && !decidedCards)
      cardReqs.push({
        room_index: index, pool: cardPool(ITEMS, ownedFor(door.reward), door.reward, held, promise, needs),
        count: CARDS_PER_OFFER, pity: needMisses >= 3, temptation: offersMade % 4 === 3,
      });
    else if (stage === "shop")
      for (const k of ["stat", "affix", "spell"] as const)
        cardReqs.push({
          room_index: index, pool: cardPool(ITEMS, ownedFor(k), k, held, {}, needs), count: 1,
          pity: false, temptation: false, salt: `shop_${k}`,
        });
    const offerReq: OfferRequest = { cards: cardReqs };

    // The Director still plans the fights; the merchant and the boss are
    // placed directly, as the scene does, because neither is an encounter.
    const planned = isFight
      ? await director.planRoom(ctx, { room_index: index, door_slot: 0, room_type: roomType }, tension,
        cardReqs.length ? offerReq : undefined)
      : null;
    // What the room was actually built at: round 1 decided it (doc 004), so it
    // comes off the plan rather than off a request made a room earlier.
    const builtTension: Tension = planned?.tension ?? tension;
    const plan = planned ? planned.plan : fixedRoom(stage === "boss" ? "boss" : "shop", src.stream("fixed", index));
    const answered = stage === "boss" || cardReqs.length === 0 ? null
      : planned?.offer ?? await director.planOffer(ctx, offerReq);

    let cards: OfferCard[] = [];
    const cardIds = decidedCards ?? (isFight && door.reward !== "gold" ? answered?.cards[0]?.ids : undefined);
    if (cardIds && door.reward !== "gold") {
      cards = cardsFor(ITEMS, door.reward, cardIds, promise);
      // Pity reads whether a card of a need reached the screen, against the build as it stands.
      const pool = cardPool(ITEMS, ownedFor(door.reward), door.reward, held, promise, needs);
      needMisses = cardIds.some((id) => pool.candidates.find((c) => c.id === id)?.facts.includes("need")) ? 0 : needMisses + 1;
      offersMade++;
    } else if (stage === "shop") {
      answered?.cards.forEach((p, i) => cards.push(...cardsFor(ITEMS, cardReqs[i]!.pool.kind, p.ids)));
    }
    const offer = offerKind ? { cards } : null;
    // The doors out: a fixed exit now, the Director's once the reward is taken
    // (`openPortals`). Held in arrays the route and the journal share, so the
    // doors land in both when they are decided.
    const exit = fixedExit(index);
    let doorsOut: DoorOffer[] = exit
      ? exit.map((p) => ({ reward: p.reward, difficulty: "normal" as const, grade: 1, onward: true }))
      : [];
    const portalsOutWords: string[] = doorsOut.map(doorWord);
    const doorKinds: string[] = doorsOut.flatMap((d) => (d.onward ? [] : [d.npc ?? d.reward]));
    const journalDoors: JournalDoor[] = doorsOut.filter((d) => !d.onward).map(journalDoor);

    if (stage === "boss" && !atBoss)
      atBoss = {
        spells: slots.flatMap((x, i) => (x ? [{ id: x.base, level: spellLevels[i] ?? 1, affixes: (spellAffixes[i] ?? []).map((a) => `${a.id}${a.tier}`) }] : [])),
        stats: statsTaken, hearts, gold, level: levelAt(xp).level,
      };
    const world = createWorld({
      room: plan, encounter: planned?.plan.encounter ?? null, staff, slots,
      hearts, rng: src.stream("gameplay", index), mods, rage, xp,
      /*
       * **The early economy** (doc 003): a run whose build has not taken shape
       * is paid more per body, so it can reach a vendor and buy the piece the
       * floor has not offered it. The cap is `COIN_BOOST_MAX`.
       */
      coinBoost: ctx.labels.build_shape === "formed" ? 1 : ctx.labels.build_shape === "forming" ? 1.4 : COIN_BOOST_MAX,
      fireTokens: knob("JR_FIRE_TOKENS"), flightBudget: knob("JR_FLIGHT"),
      // Where in the run this room is, for the encounter ramp (doc 005).
      roomIndex: index,
      // `JR_SPAWN=camps` places the encounter at the start, in camps.
      placement: process.env.JR_SPAWN === "camps" ? "camps" : "waves",
    });
    spellAffixes.forEach((affixes, i) => {
      const slot = world.spells[i];
      if (!slot || !affixes) return;
      let next = slot;
      for (const a of affixes) next = attachAffix(next, a.id, a.tier) ?? next;
      world.spells[i] = next;
    });
    spellLevels.forEach((level, i) => {
      const slot = world.spells[i];
      if (slot && level > 1) world.spells[i] = withLevel(slot, level);
    });
    if (stage === "boss") {
      const boss = makeEnemy(world.nextEnemyId++, "boss", (GRID_W / 2) * TILE_PX, (GRID_H / 2) * TILE_PX, []);
      boss.spawnFadeMs = 0;
      boss.awake = true;
      world.enemies.push(boss);
    }

    traceRoom(seed, index);
    /*
     * **The drink**, as the scene has it: the reference player walks to the
     * fountain and takes it. Both fountains are the same act — the one at the
     * vendors' stop before the boss, and the one a portal led to mid-run — so
     * the harness drinks at both, and a bar already full refuses rather than
     * spends, which is what the prompt does.
     */
    if (stage === "shop" || fountainRoom) {
      const max = MAX_HEARTS + liveMods().maxHearts;
      if (fountainWouldHeal(world.player.hearts, max)) {
        world.player.hearts = fountainDrink(world.player.hearts, max);
        fountainsDrunk++;
      }
    }
    if (isFight || stage === "boss") {
      const key = stage === "boss" ? "boss" : roomType;
      WAVES.set(key, [...(WAVES.get(key) ?? []), 1 + world.pendingWaves.length]);
    }
    const roomLog = emptyRoom(index, roomType);
    const result = !isFight && stage !== "boss"
      ? { cleared: true, heartsLost: 0, ms: 0, enemiesKilled: 0 }
      // The spread measure is about assembled rooms; the boss is placed, not
      // assembled, and one body in a hall would read as an empty floor.
      : fight(
          world, profile, stage === "boss" ? BOSS_TIMEOUT_MS : ROOM_TIMEOUT_MS,
          roomType === "combat" || roomType === "elite", roomLog,
        );
    roomLog.ms = Math.round(result.ms);
    // The mana economy, as the browser's recorder also writes it (doc 011).
    roomLog.castPresses = world.stats.castPresses;
    roomLog.castRefusedMana = world.stats.castRefusedMana;
    roomLog.manaShortMs = Math.round(world.stats.manaBelowKeyMs);
    log.push(roomLog);
    hearts = world.player.hearts;
    rage = world.player.rage;
    // What the fight paid, and the level it reached (`run/levels.ts`).
    xp = world.xp;
    roomLog.level = world.level;
    heartsLostRecent = result.heartsLost;
    lastClearMs = result.ms;
    if (isFight) measures.push(measureOf(world.stats));
    if (isFight && result.cleared) clearedMs.push(result.ms);
    if (isFight) nearShare = roomLog.ms > 0 ? roomLog.nearMs / roomLog.ms : 0;
    totalMs += result.ms;
    // Doc 003's economy: a clear pays, an elite pays more.
    if (isFight) gold += elite ? 28 : 12;
    const grade = isFight ? door.grade : 1;

    let reward: string | null = null;
    if (hearts > 0 && result.cleared && offerKind) {
      if (offer && offer.cards.length === 0) {
        /*
         * A gold room scatters coins; the sum is what the scene pays. It used
         * to be its own formula here — `GOLD_CARD_VALUE * 2 * grade` — which
         * was 24 gold against the scene's 8 coins, so the harness measured an
         * economy the game did not have. One function, both callers.
         */
        gold += goldRoomCoins(grade) * COIN_VALUE;
        reward = "gold";
      } else if (offer) {
        const card = chooseCard(offer.cards, hearts, stage === "shop" ? gold : null, {
          held: world.spells.flatMap((x) => (x ? [x.item.base] : [])),
          emptyKeys: world.slots.filter((x) => x === null).length,
          style: preset,
        });
        if (card) {
          pickTags.push([...cardStyleTags(ITEMS, card.kind, card.itemId)]);
          if (stage === "shop") gold -= MERCHANT_PRICE[card.kind] ?? 0;
          reward = card.label;
          if (card.kind === "stat") {
            statsTaken++;
            statsTaken_.push(card.itemId);
            for (let k = 0; k < Math.min(2, card.grade ?? 1); k++) {
              mods = applyStat(mods, card.itemId);
              if (card.itemId === "vigour") hearts += 1;
            }
          } else if (card.kind === "spell" && world.spells.some((x) => x?.item.base === card.itemId)) {
            const at = world.spells.findIndex((x) => x?.item.base === card.itemId);
            spellLevels[at] = Math.min(SPELL_LEVEL_MAX, (spellLevels[at] ?? 1) + (card.grade ?? 1));
          } else if (card.kind === "spell") {
            const free = world.slots.findIndex((x) => x === null);
            if (equipItem(world, card.itemId, `${card.itemId}-${index}`, ITEMS)) {
              slots.splice(0, slots.length, ...world.slots);
              owned.push(card.itemId);
              if (free >= 0) spellLevels[free] = card.grade ?? 1;
            } else {
              inventory.push(plainInstance(card.itemId, `${card.itemId}-${index}`));
            }
          } else if (card.kind === "affix") {
            const def = spellAffixById(card.itemId);
            const fits = (x: (typeof world.spells)[number]) =>
              !!x && (!def || affixFitsSpell(def, ITEMS.get(x.item.base), x.affixes.map((a) => a.id)));
            let at = world.spells.findIndex((x) => x?.affixes.some((a) => a.id === card.itemId));
            if (at < 0) at = world.spells.findIndex((x) => fits(x) && x!.affixes.length < AFFIX_SLOTS);
            const slot = at >= 0 ? world.spells[at] : null;
            const next = slot ? attachAffix(slot, card.itemId, card.grade ?? 1) : null;
            if (next && at >= 0) {
              spellAffixes[at] = next.affixes;
              owned.push(card.itemId);
            }
          }
        }
      }
    }

    /*
     * **The blacksmith**, at the pre-boss stop and at a smith room mid-run:
     * what gold is left raises the lowest-level key first, as a player readying
     * for the boss would. Measured before this, the reference player never used
     * either — so every route review reported a run reaching the boss on level-1
     * spells, which said more about the harness than about the game.
     */
    if (stage === "shop" || door.npc === "smith") {
      for (;;) {
        const keys = slots.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
        const i = keys.sort((a, b) => (spellLevels[a] ?? 1) - (spellLevels[b] ?? 1))[0];
        if (i === undefined) break;
        const price = SMITH_PRICE[spellLevels[i] ?? 1];
        if (price === undefined || gold < price) break;
        gold -= price;
        spellLevels[i] = (spellLevels[i] ?? 1) + 1;
      }
    }

    /*
     * The floor, asserted over a whole run. A fight room that produced fewer
     * bodies than the ramp's minimum is the free-reward-room bug (doc 005).
     */
    if (roomType === "combat" || roomType === "elite") {
      const spawned = world.stats.enemiesSpawned;
      const least = rampMinimum(index);
      if (spawned < least) THIN_ROOMS.push({ seed, index, spawned, least });
    }

    rooms.push({
      route: {
        doorIn: doorWord(door),
        portalsOut: portalsOutWords,
        cards: cards.map((c) => `${c.itemId || c.kind}${(c.grade ?? 1) > 1 ? `@${c.grade}` : ""}`),
        dead: cards.flatMap((c) => {
          if (c.kind !== "affix") return [];
          const def = spellAffixById(c.itemId);
          return def && !held.some((key) => affixFitsHeld(def, key)) ? [c.itemId] : [];
        }),
        build: slots.flatMap((x, i) => (x
          ? [`${x.base}@${spellLevels[i] ?? 1}${(spellAffixes[i] ?? []).length ? `[${(spellAffixes[i] ?? []).map((a) => `${a.id}${a.tier}`).join(",")}]` : ""}`]
          : [])),
        labels: {
          build_shape: ctx.labels.build_shape ?? "forming",
          build_gaps: slots.some((x) => x === null) ? "some" : "none",
          gold: ctx.labels.gold,
          health: ctx.labels.health,
          clear_speed: ctx.labels.clear_speed,
          run_progress: ctx.labels.run_progress,
        },
      },
      index, type: roomType, space: plan.params.space, tension: builtTension,
      symmetry: plan.params.symmetry,
      mood: {
        temperature: plan.params.mood.temperature,
        brightness: plan.params.mood.brightness,
        particles: plan.params.mood.particle_intensity,
      },
      levels: slots.flatMap((x, i) => (x ? [spellLevels[i] ?? 1] : [])),
      cleared: result.cleared, heartsLost: result.heartsLost, ms: Math.round(result.ms),
      enemies: result.enemiesKilled, rewardKind: offerKind, reward,
      shape: planned?.plan.encounter
        ? {
            density: planned.plan.encounter.profile.density,
            waves: planned.plan.encounter.profile.wave_structure,
            // Whether the room had a priority target, so the route review can
            // report the share (`LOOK_REPEAT_PENALTY` applies to it too).
            anchor: planned.plan.encounter.profile.anchor,
            roster: planned.plan.encounter.waves.reduce((a, w) => a + w.spawns.reduce((b, x) => b + x.count, 0), 0),
          }
        : null,
      sources: planned ? [planned.source.params, planned.source.encounter] : ["fixed", "none"],
    });

    /*
     * The room, as the briefing will read it back. Written here rather than
     * derived later because half of it — which bodies were on the floor, how
     * low the bar went, which of them took the most — only the finished world
     * knows.
     */
    {
      const hurtByEnemy = Object.entries(world.stats.hurtByEnemy)
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      const bodies = [...new Set(
        (planned?.plan.encounter?.waves ?? []).flatMap((w) => w.spawns.map((x) => x.archetype)),
      )];
      // `door_taken` is the door out of *this* room, which is chosen at the
      // bottom of the loop; the entry is patched there.
      journal_.push({
        index, type: door.npc ?? roomType, tension: builtTension,
        space: plan.params.space, size: plan.params.size, symmetry: plan.params.symmetry, mood: plan.params.mood,
        ...(planned?.plan.encounter ? { encounter: planned.plan.encounter.profile } : {}),
        health_lost: result.heartsLost * HP_PER_HEART,
        health_low: world.stats.heartsLow * HP_PER_HEART,
        ...(isFight || stage === "boss" ? {
          seconds: result.ms / 1000,
          expected_seconds: expectedClearMsFor(index, clearedMs) / 1000,
        } : {}),
        hurt_by: hurtFamilyOf(world.stats),
        ...(hurtByEnemy ? { hurt_most_by: hurtByEnemy } : {}),
        ...(bodies.length ? { enemies: bodies } : {}),
        doors_offered: doorKinds,
        doors: journalDoors,
        ...(reward ? { picked: [reward.toLowerCase().replace(/ /g, "_")] } : {}),
        passed_over: cards
          .map((c) => c.itemId || c.kind)
          .filter((id) => id !== reward?.toLowerCase().replace(/ /g, "_")),
        ...(reward === "gold" ? { took_gold_instead: true } : {}),
      });
    }
    rooms_.push(roomType);
    tensions_.push(builtTension);
    heartsLost_.push(result.heartsLost);
    /*
     * The offer's history, as the Director reads it back: the badges this room
     * ended with, and the badge the player walked in through. A fixed exit is
     * not a badge the player chose, so it is not counted as one.
     */
    // A fixed exit is not a badge the player chose, so it reveals no preference.
    if (!door.onward) doorsTaken_.push(door.npc ?? door.reward);
    moods_.unshift(plan.params.mood);
    symmetries_.unshift(plan.params.symmetry);
    spaces_.unshift(plan.params.space);
    if (plan.skeleton) skeletons_.unshift(plan.skeleton);
    if (planned?.profile) profiles_.push(planned.profile);
    scores_.push("neutral");
    if (!result.cleared) { doorsOffered_.push([]); break; }
    if (stage === "boss") { doorsOffered_.push([]); break; }

    /*
     * **The doors open now**, with the reward taken and the fight's cost
     * known: one request decides the portals and, for every kind a portal
     * could be, the cards behind it (`openPortals`). They used to be decided
     * as the room began, before the fight they depend on — a player who
     * walked in on 37 health and out on 12 was offered doors chosen for 37.
     */
    if (!exit) {
      doorsOut = await openPortals(index, elite);
      portalsOutWords.push(...doorsOut.map(doorWord));
      doorKinds.push(...doorsOut.flatMap((d) => (d.onward ? [] : [d.npc ?? d.reward])));
      journalDoors.push(...doorsOut.filter((d) => !d.onward).map(journalDoor));
    }
    doorsOffered_.push(doorsOut.flatMap((d) => (d.npc || d.onward ? [] : [d.reward])));

    /*
     * No `planDoors` call. The next room's pitch is decided inside that room's
     * own round-1 request now (doc 004), so asking for it here would be a
     * third sequential request per room for an answer the room makes anyway.
     * The portals are the two-axis offer doc 003 describes; the player picks
     * by currency.
     */
    /*
     * The reference player fights every room, with one exception: **it takes
     * the fountain when it is offered and it is hurt.** A vendor's door is
     * still declined, because the reference player's purchases are made at
     * the pre-boss stop and a mid-run shop would measure the chooser rather
     * than the rooms; the fountain is different, because health is the one
     * thing the balance numbers are about.
     */
    const doors = doorsOut;
    if (doors.some((d) => d.npc && d.npc !== "fountain")) npcOffers++;
    const spring = doors.find((d) => d.npc === "fountain");
    if (spring) { fountainsOffered++; fountainOffers++; }
    const offered = doors.filter((d) => !d.npc);
    /*
     * **The blacksmith is taken; the merchant is not.**
     *
     * Declining every vendor measured a run that never bought anything, and
     * the smith is the run's only mid-run source of spell levels — so a route
     * review of a run that always declined it could only ever report that
     * levels do not rise. The merchant stays declined for the reason it always
     * was: what it sells is a choice, and a harness that made it would be
     * measuring the chooser rather than the rooms. The smith sells one thing.
     */
    const forge = doors.find((d) => d.npc === "smith");
    const affixSlotsFree = spellAffixes.slice(0, slots.filter(Boolean).length)
      .reduce((n, a) => n + Math.max(0, AFFIX_SLOTS - (a?.length ?? 0)), 0)
      + Math.max(0, slots.filter(Boolean).length - spellAffixes.length) * AFFIX_SLOTS;
    const levelsRaised = slots.filter((x, i) => x && (spellLevels[i] ?? 1) > 1).length;
    door = spring && hearts <= (MAX_HEARTS + liveMods().maxHearts) / 2
      ? spring
      : forge && gold >= (SMITH_PRICE[Math.min(...slots.flatMap((x, i) => (x ? [spellLevels[i] ?? 1] : [1])))] ?? 999)
      ? forge
      : offered.length > 0
      ? choosePortal(offered, hearts, world.spells.filter(Boolean).length, { affixSlotsFree, levelsRaised })
      : { reward: "stat", difficulty: "normal", grade: 1 };
    // The door out of the room just played, recorded on that room's entry.
    const last = journal_.at(-1);
    if (last && !door.onward)
      journal_[journal_.length - 1] = { ...last, door_taken: door.npc ?? door.reward };
  }

  return {
    seed, arm, rooms, log, profile: profile.name,
    survived: hearts > 0,
    heartsLeft: hearts,
    totalMs: Math.round(totalMs),
    items: slots.flatMap((s) => (s ? [s.base] : [])),
    atBoss,
    fountains: { offered: fountainsOffered, taken: fountains, drunk: fountainsDrunk },
    measures,
  };
}

/**
 * How the reference player picks a portal. Taking the first every time is not a
 * player: it never takes a stat when it is hurt and never takes a spell when
 * it has a free key, so the run measures a build that nobody would make.
 *
 * Kept deliberately simple — it is a *reference*, and a clever chooser would
 * make the difficulty numbers describe the chooser rather than the rooms.
 */
function choosePortal(
  offered: readonly DoorOffer[], hearts: number, spellsHeld: number,
  /** What the staff still has room for, so the reference player is not a rule. */
  staff: { readonly affixSlotsFree: number; readonly levelsRaised: number } = { affixSlotsFree: 9, levelsRaised: 0 },
): DoorOffer {
  const by = (k: RewardCardKind) => offered.find((d) => d.reward === k);
  // A fixed exit is the only door there is; nothing to choose between.
  const onward = offered.find((d) => d.onward);
  if (onward) return onward;
  // Hurt: the stat door, because `Vigour` lives there.
  if (hearts <= MAX_HEARTS / 2 && by("stat")) return by("stat")!;
  // A free key: fill it.
  if (spellsHeld < 3 && by("spell")) return by("spell")!;
  /*
   * **A full staff with nothing raised takes the spell door.**
   *
   * Taking the affix door whenever it appeared was the reference player's own
   * bug, and it is the one that made the route reviews read as they did: every
   * door taken was affix, so no spell was ever levelled and the run reached the
   * boss on a staff of level-1 spells. A person does not do that — once the
   * affix slots are full an affix card is a duplicate, and a spell door to a
   * full staff now offers both a level and a replacement.
   */
  if (spellsHeld >= 3 && (staff.affixSlotsFree === 0 || staff.levelsRaised === 0) && by("spell"))
    return by("spell")!;
  // Healthy and equipped: take an elite if one is offered, otherwise an affix.
  const elite = offered.find((d) => d.difficulty === "elite");
  if (hearts >= MAX_HEARTS - 1 && elite) return elite;
  return by("affix") ?? by("spell") ?? by("stat") ?? offered[0]!;
}

/**
 * How the reference player picks a card, in the order a person with a stated
 * style reads a reward screen:
 *
 * 1. Hurt, it takes healing if it is there.
 * 2. **With an empty key, a spell that fills it.** A key with nothing on it is
 *    the one thing on the staff the player can see is missing, and the game's
 *    own screen says so (an empty key casts nothing). Among the new spells it
 *    takes the first tagged with the style it chose, else the first new one.
 *    Taking the first card instead — which on an early screen was the
 *    Director's top answer, the starter's own level (jev-findings 29) — held a
 *    Barrage run on one key through room 3 and a Blade run through room 4,
 *    which is the chooser's behaviour and not a person's.
 * 3. Otherwise the first card, which is the order the offer was drawn in and
 *    therefore not a preference the chooser invented.
 *
 * With a price list it considers only what it can afford. Kept deliberately
 * simple, as `choosePortal` is: a reference, not a strategy.
 */
function chooseCard(
  cards: readonly OfferCard[], hearts: number, gold: number | null,
  staff: { readonly held: readonly string[]; readonly emptyKeys: number; readonly style: Archetype } =
    { held: [], emptyKeys: 0, style: "spam" },
): OfferCard | null {
  const affordable = cards.filter((c) => gold === null || gold >= (MERCHANT_PRICE[c.kind] ?? 0));
  if (affordable.length === 0) return null;
  if (hearts <= MAX_HEARTS / 2) {
    const heal = affordable.find((c) => c.itemId === "vigour");
    if (heal) return heal;
  }
  if (staff.emptyKeys > 0) {
    const fresh = affordable.filter((c) => c.kind === "spell" && !staff.held.includes(c.itemId));
    const onStyle = fresh.find((c) => cardStyleTags(ITEMS, "spell", c.itemId).includes(staff.style));
    if (onStyle ?? fresh[0]) return (onStyle ?? fresh[0])!;
  }
  return affordable[0]!;
}

/** The scene's price list. Doc 003's economy: 15 / 30 / 50 by rarity. */

/**
 * The two rooms that are not encounters, built the way the scene builds them.
 * The merchant gets any open arena; the boss gets its own archetype.
 */
function fixedRoom(stage: "shop" | "boss", rng: ReturnType<RngSource["stream"]>) {
  const space = stage === "boss" ? BOSS_ARCHETYPES[0]!.id : "open_arena";
  const g = generateRoom(
    { space, symmetry: "mirrored", size: "standard", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
    "S", stage === "boss" ? "boss" : "combat", rng, { plain: true },
  );
  return toRoomPlan(g, { id: `fixed-${stage}`, seed_key: `fixed-${stage}`, reward_kind: "item", params_source: "rule" });
}

/**
 * `JR_TRACE=<seed>:<room index>` prints where the player and its nearest enemy
 * are every five seconds of that one room. A timeout dump says where the
 * model ended; this says how it got there, which is the difference between
 * "it never found them" and "it walked there and stopped".
 */
let traceKey = "";
export function traceRoom(seed: string, index: number): void {
  traceKey = `${seed}:${index}`;
}

export function fight(
  world: World, profile: SkillProfile, timeoutMs = ROOM_TIMEOUT_MS, measureView = false,
  /** The room's playtest counters, filled in as the fight runs; see `playtest-log.ts`. */
  log?: ReturnType<typeof emptyRoom>,
): { cleared: boolean; heartsLost: number; ms: number; enemiesKilled: number } {
  let killed = 0;
  let ms = 0;
  let peakBullets = 0;
  let bulletSum = 0;
  let samples = 0;
  // Counted so a timeout can say whether the model was attacking at all.
  let swings = 0;
  /*
   * The bodies that were not part of the opening roster: a wave that has been
   * released is walking in from off the edge of the screen, and the seconds it
   * spends doing that are their own reason for an empty view.
   */
  const opening = new Set(world.enemies.map((e) => e.id));
  const castsAtStart = new Map(world.spells.flatMap((sl) => (sl ? [[sl.item.base, SPELL_USE.get(sl.item.base)?.casts ?? 0] as const] : [])));
  const reinforcements = {
    has: (id: number): boolean => !opening.has(id),
  };
  while (ms < timeoutMs && world.player.hearts > 0) {
    const before = world.player.swingMs;
    const beforeDash = world.player.dashMs;
    const castsBefore = world.stats.shotsFired;
    const input = referenceInput(world, profile);
    {
      const costs = world.spells.flatMap((sl) => (sl ? [slotCost(sl, ITEMS, world.staff)] : []));
      const cheapest = costs.length ? Math.min(...costs) : Infinity;
      MANA.ms += STEP_MS;
      if (world.player.mana < cheapest) MANA.starvedMs += STEP_MS;
      MANA.fillSum += world.player.mana / world.staff.mana_max;
      MANA.samples++;
      if (input.spell !== null && input.spell !== undefined) {
        const sl = world.spells[input.spell];
        if (sl && sl.cooldownMs <= 0) {
          MANA.presses++;
          if (world.player.mana < slotCost(sl, ITEMS, world.staff)) MANA.refused++;
        }
      }
    }
    if (process.env.JR_TRACE === traceKey && Math.round(ms) % 5000 < STEP_MS * 3) {
      const p = world.player;
      const e = world.enemies.reduce<(typeof world.enemies)[number] | null>((best, x) =>
        !best || Math.hypot(x.x - p.x, x.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? x : best, null);
      console.log(
        `    trace ${Math.round(ms / 1000)}s player@${Math.round(p.x)},${Math.round(p.y)} move ${input.moveX.toFixed(1)},${input.moveY.toFixed(1)}`
        + (e ? ` nearest ${e.archetype}@${Math.round(e.x)},${Math.round(e.y)} awake=${e.awake} los=${hasLineOfSight(world.room.grid, p.x, p.y, e.x, e.y)}` : " no enemies")
        + ` alive ${world.enemies.length} pending ${world.pendingWaves.length}`
        + ` tileP ${world.room.grid[Math.floor(p.y / TILE_PX) * GRID_W + Math.floor(p.x / TILE_PX)]}`
        + (e ? ` tileT ${world.room.grid[Math.floor(e.y / TILE_PX) * GRID_W + Math.floor(e.x / TILE_PX)]}` : ""),
      );
      console.log(
        `      state hearts ${p.hearts} slip ${Math.round(p.slipMs)} stun ${Math.round(p.stunMs)} swing ${Math.round(p.swingMs)} dash ${Math.round(p.dashMs)}`
        + ` hurt ${Math.round(p.hurtMs)} speedMod ${p.mods.speed} slide ${p.slideX.toFixed(1)},${p.slideY.toFixed(1)} exited ${world.exited} offer ${world.offer ? "yes" : "no"}`,
      );
      console.log(
        `      route ${lastDecision.route ? `${lastDecision.route.x.toFixed(2)},${lastDecision.route.y.toFixed(2)}` : "null"} target ${lastDecision.target} here ${lastDecision.here} best ${lastDecision.bestCost.toFixed(1)}`,
      );
    }
    const readyBefore = world.spells.map((sl) => (sl ? [sl.cooldownMs, sl.bank ?? -1, world.player.chargeKey] : null));
    step(world, input);
    if (before <= 0 && world.player.swingMs > 0) swings++;
    world.spells.forEach((sl, i) => {
      const was = readyBefore[i];
      if (!sl || !was) return;
      const use = SPELL_USE.get(sl.item.base) ?? noUse();
      use.heldMs += STEP_MS;
      const started = sl.cooldownMs > was[0]! + 1
        || (was[1]! >= 1 && (sl.bank ?? -1) < was[1]! && (sl.bank ?? 0) < 1)
        || (was[2] === i && world.player.chargeKey !== i);
      if (started) use.casts++;
      SPELL_USE.set(sl.item.base, use);
    });
    /*
     * The per-room counters the playtest log is made of, measured the same way
     * the browser measures them: a dash and a swing are counted when the sim
     * *starts* one rather than when the key is held, so a held key is one act,
     * and a cast is counted off `shotsFired` for the same reason.
     */
    if (log) {
      if (before <= 0 && world.player.swingMs > 0) log.swings++;
      if (beforeDash <= 0 && world.player.dashMs > 0) log.dashes++;
      if (world.stats.shotsFired > castsBefore) log.casts++;
      const p = world.player;
      for (const b of world.enemyBullets)
        if (b.alive && Math.hypot(b.x - p.x, b.y - p.y) < NEAR_BULLET_PX) { log.nearMs += STEP_MS; break; }
    }
    if (world.enemies.length > 0) {
      const live = liveCount(world.enemyBullets);
      DENSITY.samples++;
      DENSITY.bullets += live;
      DENSITY.peakBullets = Math.max(DENSITY.peakBullets, live);
      if (live > 30) DENSITY.over30++;
      DENSITY.attackers += world.enemies.filter((e) => e.hasFireToken || e.hasToken).length;
    }
    // How much of the room the fight is occupying, and when it is not, why.
    // See `VIEW`.
    if (measureView && !world.cleared) {
      const p = world.player;
      const live = world.enemies.filter((e) => e.hp > 0 && e.spawnFadeMs <= 0);
      const inRect = live.filter((e) => e.awake
        && Math.abs(e.x - p.x) <= world.viewHalf.x + e.radius
        && Math.abs(e.y - p.y) <= world.viewHalf.y + e.radius);
      /*
       * **Visible**, not merely on screen: a body behind a pillar inside the
       * view rectangle is not a fight the player can see, and counting it as
       * one is how a room that feels empty measures full.
       */
      const seen = inRect.filter((e) => {
        // Three rays, not one: a body half behind a pillar is a body the
        // player can see, and a single centre-to-centre ray calls it hidden.
        const a = Math.atan2(e.y - p.y, e.x - p.x) + Math.PI / 2;
        const ox = Math.cos(a) * e.radius * 0.8;
        const oy = Math.sin(a) * e.radius * 0.8;
        return hasLineOfSight(world.room.grid, p.x, p.y, e.x, e.y)
          || hasLineOfSight(world.room.grid, p.x, p.y, e.x + ox, e.y + oy)
          || hasLineOfSight(world.room.grid, p.x, p.y, e.x - ox, e.y - oy);
      }).length;
      // What each awake body is doing; see `STATES`.
      for (const e of live) {
        if (!e.awake) continue;
        const def = ENEMIES[e.archetype];
        const gap = Math.hypot(e.x - p.x, e.y - p.y);
        const los = hasLineOfSight(world.room.grid, e.x, e.y, p.x, p.y);
        /*
         * A body counts as idle only when it has neither attacked nor made a
         * readable move for a while — not merely because it is waiting for a
         * turn. Waiting is the design; hovering while waiting is the fault.
         */
        const state = e.staggerMs > 0 || e.frozenMs > 0 ? "stunned"
          : e.attack !== "approach" ? "attacking"
          : e.plantMs > 0 || e.pose !== "" ? "attacking"
          : e.telegraphMs > 0 || e.hasFireToken ? "attacking"
          : e.threatMs <= THREAT_SEEN_MS ? "reposition"
          : def.melee !== null ? (e.hasToken ? "closing" : "wait_melee")
          : !los || gap < 78 ? "silenced"
          : (def.pattern ?? def.ranged) ? "wait_fire"
          : "reposition";
        const row = STATES.get(e.archetype) ?? Object.fromEntries(STATE_KEYS.map((k) => [k, 0]));
        row[state] = (row[state] ?? 0) + 1;
        STATES.set(e.archetype, row);
      }
      VIEW.samples++;
      VIEW.inView += seen;
      VIEW.peak = Math.max(VIEW.peak, seen);
      if (seen > VIEW_CROWD) VIEW.crowded++;
      if (seen === 0) {
        VIEW.empty++;
        // One cause per sample, most specific first.
        const awake = live.filter((e) => e.awake);
        if (inRect.length > 0) VIEW.occluded++;
        else if (live.length === 0) VIEW.gate++;
        else if (awake.length === 0) VIEW.unfound++;
        else if (awake.some((e) => reinforcements.has(e.id))) VIEW.commute++;
        else if (live.length <= STRAGGLERS) VIEW.stragglers++;
        else VIEW.other++;
      }
    }
    // What is taking the hearts, not just how many. "Too hard" is not
    // actionable; "half the damage is contact from chasers" is.
    for (const ev of world.events)
      if (ev.kind === "player_hit" && ev.amount !== 0) {
        // The whole cause, archetype included: "contact" alone does not say
        // whether a chaser landed a lunge or a turret was walked into.
        const cause = ev.what ?? "unknown";
        HURT_BY.set(cause, (HURT_BY.get(cause) ?? 0) + 1);
        // The same event, in the log's units: HP rather than hits, keyed by the
        // sim's own cause string so nothing here has to know the roster.
        if (log) {
          const hp = (ev.amount ?? 0) * HP_PER_HEART;
          log.hpLost += hp;
          log.bySource[cause] = (log.bySource[cause] ?? 0) + hp;
        }
        // Where the player was standing when it landed, behind a flag. A cause
        // tally says which enemy is expensive; this says whether the answer is
        // a smaller number or better spacing, which are opposite fixes.
        if (process.env.JR_MELEE === "1" && cause.startsWith("melee:")) {
          /*
           * The body that actually landed it, not the nearest one.
           *
           * Attributing to the nearest enemy reported phases that cannot hit —
           * `approach` among them — whenever two bodies were close together,
           * which made the geometry medians describe whichever body happened
           * to be nearer rather than the one holding the blade.
           */
          const archetype = cause.slice("melee:".length);
          let best: { d: number; e: (typeof world.enemies)[number] } | null = null;
          for (const e of world.enemies) {
            if (e.archetype !== archetype) continue;
            if (!e.swing.hitIds.includes(-1)) continue;
            const d = Math.hypot(e.x - world.player.x, e.y - world.player.y);
            if (!best || d < best.d) best = { d, e };
          }
          if (best) {
            const arc = Math.abs(Math.atan2(
              world.player.y - best.e.y, world.player.x - best.e.x,
            ) - best.e.swing.facing);
            MELEE_HITS.push({
              cause, dist: best.d, radius: best.e.radius,
              phase: best.e.attack, reach: best.e.swing.reach,
              offAxisDeg: (Math.min(arc, Math.PI * 2 - arc) * 180) / Math.PI,
              saw: lastPlan.sawAttacking.includes(best.e.id),
              planAgeMs: world.stats.elapsedMs - lastPlan.atMs,
            });
          }
        }
      }
    killed += world.events.filter((e) => e.kind === "enemy_killed").length;
    // Bodies, not broken pots: the browser counts kills the same way.
    if (log) log.kills += world.events.filter((e) => e.kind === "enemy_killed" && !e.what?.startsWith("prop:")).length;
    ms += STEP_MS;
    let live = 0;
    for (const b of world.enemyBullets) if (b.alive) live++;
    peakBullets = Math.max(peakBullets, live);
    bulletSum += live;
    samples++;
    if (worldCleared(world)) break;
  }
  const cleared = worldCleared(world) && world.player.hearts > 0;
  if (process.env.JR_BULLETS === "1") {
    console.log(`  bullets: peak ${peakBullets}, mean ${(bulletSum / Math.max(1, samples)).toFixed(1)}`);
  }
  if (!cleared && world.player.hearts > 0) {
    // A room the reference player cannot finish is a bug, not a difficulty
    // reading, so it says what was left standing rather than timing out
    // silently into the averages.
    const left = world.enemies
      .map((e) => `${e.archetype}@${Math.round(e.x)},${Math.round(e.y)} hp${Math.round(e.hp)}`)
      .join(" ");
    /*
     * What the player was *doing*, not only where it was. Two runs in sixteen
     * end with the model parked 55 px from a nearly dead body on full mana,
     * and "it was 55 px away" cannot distinguish a model that is swinging and
     * missing from one that never swings at all.
     */
    const p = world.player;
    console.log(`  TIMEOUT after ${Math.round(ms / 1000)}s: ${world.enemies.length} alive [${left}], pending waves ${world.pendingWaves.length}`);
    if (process.env.JR_TRACE) {
      // The room as a picture: P the player, E each enemy, # wall, . floor, + door.
      const g = world.room.grid;
      const rows: string[][] = [];
      for (let y = 0; y < GRID_H; y++) {
        const row: string[] = [];
        for (let x = 0; x < GRID_W; x++) {
          const t = g[y * GRID_W + x];
          row.push(t === 0 ? "." : t === 1 ? "#" : "+");
        }
        rows.push(row);
      }
      for (const e of world.enemies) rows[Math.floor(e.y / TILE_PX)]![Math.floor(e.x / TILE_PX)] = "E";
      rows[Math.floor(p.y / TILE_PX)]![Math.floor(p.x / TILE_PX)] = "P";
      for (const row of rows) console.log(`    ${row.join("")}`);
    }
    console.log(
      `    player: swings ${swings}, swinging ${p.swingMs > 0}, dash ${Math.round(p.dashCooldownMs)},`
      + ` facing ${Math.round((p.facing * 180) / Math.PI)}deg, hearts ${p.hearts}`,
    );
    // Why a room could not be finished, which is otherwise guesswork: asleep
    // and unfound, awake but behind cover, or simply out-damaged by the
    // mana economy are three different bugs with the same symptom.
    for (const e of world.enemies) {
      const p = world.player;
      const los = hasLineOfSight(world.room.grid, p.x, p.y, e.x, e.y);
      const inWall = circleHitsWall(world.room.grid, e.x, e.y, e.radius);
      const d = Math.round(Math.hypot(e.x - p.x, e.y - p.y));
      console.log(`    why: ${e.archetype} awake=${e.awake} los=${los} insideWall=${inWall} dist=${d} player@${Math.round(p.x)},${Math.round(p.y)} mana=${Math.round(p.mana)}/${world.staff.mana_max} shots=${world.stats.shotsFired ?? "?"} dmg=${Math.round(world.stats.damageDealt)}`);
    }
  }
  const held = world.spells.filter((sl) => sl !== null);
  for (const sl of held) {
    const use = SPELL_USE.get(sl.item.base);
    if (!use) continue;
    use.roomDamage += world.stats.damageDealt;
    use.swordDamage += world.stats.swordDamage;
    if (held.length !== 1) continue;
    use.soloMs += ms;
    use.soloCasts += use.casts - (castsAtStart.get(sl.item.base) ?? 0);
    use.soloSpellDamage += world.stats.damageDealt - world.stats.swordDamage;
    use.soloSwordDamage += world.stats.swordDamage;
    use.soloKills += killed;
    use.soloHearts += world.stats.heartsLost;
  }
  return { cleared, heartsLost: world.stats.heartsLost, ms, enemiesKilled: killed };
}

function context(
  seed: string, index: number, hearts: number, gold: number, staff: Staff,
  slots: readonly (ItemInstance | null)[], inventory: readonly ItemInstance[],
  history: RunHistory, preset: Archetype, lastClearMs: number, heartsLostRecent: number,
  /** The style tags of each card taken so far, for `preference.consistency`. */
  pickTags: readonly (readonly string[])[],
  /** Every cleared fight so far, for the pace `clear_speed` is read against. */
  pastMs: readonly number[],
  /** The share of the last room spent with an enemy bullet close (doc 011). */
  nearShare: number,
  /** What each fight measured, for the observed labels (`run/observed.ts`). */
  measures: readonly ReturnType<typeof measureOf>[],
  freeText?: string,
  /** What the keys are actually holding, so the build labels read the real build. */
  power?: { levels: readonly number[]; affixes: readonly (readonly AttachedAffix[])[]; mods: PlayerMods },
  /** Experience earned so far, for the level the briefing states (`run/levels.ts`). */
  xp = 0,
): RunContext {
  return {
    run_id: seed, seed, room_index: index,
    // The bar, its cap after upgrades, and the purse, for the briefing.
    health: hearts * HP_PER_HEART,
    ...(observedFigures(measures) ? { observed_figures: observedFigures(measures)! } : {}),
    max_health: (MAX_HEARTS + (power?.mods.maxHearts ?? 0)) * HP_PER_HEART,
    gold,
    level: levelAt(xp).level,
    xp_into: levelAt(xp).into,
    xp_to_next: levelAt(xp).toNext,
    labels: {
      health: bucketHealth(hearts),
      recent_damage: bucketRecentDamage(heartsLostRecent),
      clear_speed: bucketClearSpeed(lastClearMs, expectedClearMsFor(index, pastMs)),
      movement_pressure_recent: bucketMovementPressure(nearShare),
      run_progress: bucketRunProgress(index),
      gold: bucketGold(gold),
      /*
       * **`hazard_cap` is a pacing rule, not a constant.** The scene computes
       * it — doc 003: no hazards while the player is critical or has just taken
       * heavy damage — and the harness pinned it to `high`, so every option
       * grounded on it was grounded on a constant and the measurement said the
       * question was degenerate when the harness was.
       */
      tension_cap: "peak_allowed",
      hazard_cap: hearts <= 1 || heartsLostRecent >= 2 ? "none" : hearts <= 2 ? "low" : "high",
      pressure_cap: 5,
      build: { range: "mid" },
      preference: {
        dominant: heldDominantTags(slots, ITEMS),
        // Revealed preference, as doc 007 has it: two consecutive picks outside
        // the stated style are a pivot. It was hard-coded `on_plan`, which made
        // `variety` answer `low` for every offer of every run.
        consistency: bucketConsistency(pickTags, preset),
      },
      observed: observedLabels(measures),
      build_shape: buildShapeFor({
        keysFilled: slots.filter((x) => x !== null).length,
        keySlots: staff.slots,
        affixesAttached: (power?.affixes ?? []).reduce((t, a) => t + (a?.length ?? 0), 0),
        affixSlotsPerKey: AFFIX_SLOTS,
        levels: slots.flatMap((x, i) => (x ? [power?.levels[i] ?? 1] : [])),
        levelMax: SPELL_LEVEL_MAX,
      }),
    },
    staff, slots, inventory, history,
    intent: { preset, ...(freeText ? { free_text: freeText } : {}) },
    /*
     * **What the keys are actually holding** (`run/build-facts.ts`). It was
     * folded into `build_shape` and thrown away; the Director then answered
     * "which reward does this player need most" without ever being told what
     * was on the staff.
     */
    ...(power ? {
      power: {
        levels: slots.map((_, i) => power.levels[i] ?? 1),
        affixes: slots.map((_, i) => (power.affixes[i] ?? []).map((a) => ({ id: a.id, tier: a.tier }))),
        mana_max: staff.mana_max * power.mods.manaMax,
      },
    } : {}),
  };
}
