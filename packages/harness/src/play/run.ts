/**
 * Plays a whole run headless: the Director plans, the reference player fights,
 * and the result is the same simulation the browser runs. This is what makes
 * "the balance harness runs the game, not a model of it" true rather than a
 * claim (design docs 008, 011).
 */
import {
  MAX_HEARTS, RngSource, bucketClearSpeed, bucketGold, bucketHealth, SMITH_PRICE, PREBOSS_MEND_HEARTS,
  bucketMovementPressure, bucketRecentDamage, bucketRunProgress, createWorld,
  plainInstance, simulateStaff, step, worldCleared, ITEMS, STEP_MS,
  RUN_BOSS_ROOM, stageFor, applyStat, cardPool, cardsFor, cardNeedsFor, portalChoices, itemShape, CARDS_PER_OFFER, equipItem, attachAffix, withLevel, strayEliteFor,
  noMods, AFFIX_SLOTS, GOLD_CARD_VALUE, generateRoom, toRoomPlan, BOSS_ARCHETYPES,
  makeEnemy, GRID_W, GRID_H, TILE_PX, runStaff, SPELL_LEVEL_MAX, slotCost,
} from "@jr/core";
import type {
  Archetype, ItemInstance, RoomType, RunContext, RunHistory, Staff, Tension, World,
  PlayerMods, RewardCardKind, DoorOffer, OfferCard, AttachedAffix,
} from "@jr/core";
import { createDirector } from "@jr/director";
import type { CardRequest, DirectorArm, DirectorDeps, OfferRequest } from "@jr/director";
import { referenceInput, lastDecision } from "./player-model.ts";
import { hasLineOfSight, circleHitsWall } from "@jr/core";

const ROOM_TIMEOUT_MS = 120_000;
/** Doc 003 budgets the boss at two to three minutes; a two-minute clock would call a fight on budget a failure. */
const BOSS_TIMEOUT_MS = 240_000;

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

/** Where each melee hit landed, when `JR_MELEE=1`. See the push site below. */
export const MELEE_HITS: {
  cause: string; dist: number; radius: number; phase: string; reach: number; offAxisDeg: number;
}[] = [];

export interface RoomOutcome {
  readonly index: number;
  readonly type: RoomType;
  readonly space: string;
  readonly tension: Tension;
  readonly cleared: boolean;
  readonly heartsLost: number;
  readonly ms: number;
  readonly enemies: number;
  /** How the fight was built: the profile's density and staging plus roster size. */
  readonly shape: { density: string; waves: string; roster: number } | null;
  /** What the portal into this room promised: the currency, or null for the merchant and boss. */
  readonly rewardKind: RewardCardKind | null;
  /** What was actually taken, as a card label, or null. */
  readonly reward: string | null;
  readonly sources: string[];
}

export interface RunOutcome {
  readonly seed: string;
  readonly arm: DirectorArm;
  readonly rooms: readonly RoomOutcome[];
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
  } | null;
}

export async function playRun(
  seed: string, arm: DirectorArm, preset: Archetype = "spam", deps: DirectorDeps = {},
): Promise<RunOutcome> {
  const director = createDirector(arm, deps);
  const src = new RngSource(seed);
  const staff: Staff = runStaff();

  let slots: (ItemInstance | null)[] = Array.from({ length: staff.slots }, (_, i) =>
    i === 0 ? plainInstance("magic_bolt") : null);
  const inventory: ItemInstance[] = [];
  let hearts = MAX_HEARTS;
  let gold = 0;
  const rooms: RoomOutcome[] = [];
  // RunHistory is readonly by design; the run owns mutable copies and hands
  // the Director a frozen view each room.
  const rooms_: RoomType[] = [];
  const tensions_: Tension[] = [];
  const spaces_: string[] = [];
  const skeletons_: string[] = [];
  const profiles_: NonNullable<Awaited<ReturnType<typeof director.planRoom>>["profile"]>[] = [];
  const scores_: RunHistory["counter_scores"][number][] = [];
  const history = (): RunHistory => ({
    rooms: rooms_, tensions: tensions_, profiles: profiles_,
    spaces: spaces_ as RunHistory["spaces"], skeletons: skeletons_, counter_scores: scores_,
    shop_entered: rooms_.includes("shop"),
    rests_entered: rooms_.filter((r) => r === "rest").length,
    // No treasure rooms exist any more (doc 003); the field is kept for the type.
    treasures_entered: 0,
    elite_last_room: rooms_.at(-1) === "elite", shielded_rooms: 0,
  });
  let lastClearMs = 30_000;
  let heartsLostRecent = 0;
  let totalMs = 0;
  let tension: Tension = "build";
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
  let statsTaken = 0;
  let atBoss: RunOutcome["atBoss"] = null;
  const spellAffixes: (readonly AttachedAffix[])[] = [];
  const owned: string[] = slots.flatMap((x) => (x ? [x.base] : []));
  let door: DoorOffer = { reward: "spell", difficulty: "normal", grade: 1 };
  const spellLevels: number[] = [];
  let lastWasElite = false;
  // Doc 007's pity and temptation clocks, as the scene keeps them.
  let offersMade = 0;
  // Spin charges carry through a portal, as in the scene.
  let rage = 0;
  let needMisses = 0;

  for (let index = 1; index <= RUN_BOSS_ROOM && hearts > 0; index++) {
    const stage = stageFor(index);
    const elite = stage === "combat" && door.difficulty === "elite";
    const roomType: RoomType = stage === "combat" ? (elite ? "elite" : "combat") : stage;
    const ctx = context(seed, index, hearts, gold, staff, slots, inventory, history(), preset, lastClearMs, heartsLostRecent);

    // The offer's questions, built first so they can ride in the room's
    // round-1 request as they do in the scene: the portals out (doc 003) and
    // the cards in (doc 007), each over the legal answers code enumerated.
    // The merchant stocks one card of each kind; the boss room offers nothing.
    const offerKind: RewardCardKind | null =
      stage === "combat" ? door.reward : stage === "shop" ? "stat" : null;
    const held = slots.flatMap((x) => (x ? [itemShape(ITEMS.get(x.base))] : []));
    // The same facts the scene reads (task 9).
    const needs = cardNeedsFor(
      ctx.labels, preset,
      slots.flatMap((x, i) => (x ? [{ base: x.base, affixes: spellAffixes[i] ?? [] }] : [])), ITEMS,
    );
    const promise = stage === "combat" ? { school: door.school, family: door.family, grade: door.grade, style: preset } : {};
    // As in the scene: a held spell below the cap stays offerable, a copy levels it.
    const ownedFor = (k: RewardCardKind): string[] => k === "spell"
      ? slots.flatMap((x, i) => (x && (spellLevels[i] ?? 1) >= SPELL_LEVEL_MAX ? [x.base] : []))
      : owned;
    const cardReqs: CardRequest[] = [];
    if (stage === "combat" && door.reward !== "gold")
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
    const offerReq: OfferRequest = {
      ...(stage === "combat" ? {
        portals: portalChoices(
          { roomIndex: index, lastWasElite, critical: hearts <= 1, style: preset }, src.stream("portal-count", index),
        ),
      } : {}),
      cards: cardReqs,
    };

    // The Director still plans the fights; the merchant and the boss are
    // placed directly, as the scene does, because neither is an encounter.
    const planned = stage === "combat"
      ? await director.planRoom(ctx, { room_index: index, door_slot: 0, room_type: roomType }, tension, offerReq)
      : null;
    const plan = planned ? planned.plan : fixedRoom(stage === "boss" ? "boss" : "shop", src.stream("fixed", index));
    const answered = stage === "boss" ? null : planned?.offer ?? await director.planOffer(ctx, offerReq);

    let cards: OfferCard[] = [];
    if (stage === "combat" && door.reward !== "gold" && answered?.cards[0]) {
      const cardPlan = answered.cards[0];
      const pool = cardReqs[0]!.pool;
      cards = cardsFor(ITEMS, door.reward, cardPlan.ids, promise);
      needMisses = cardPlan.ids.some((id) => pool.candidates.find((c) => c.id === id)?.facts.includes("need")) ? 0 : needMisses + 1;
      offersMade++;
    } else if (stage === "shop") {
      answered?.cards.forEach((p, i) => cards.push(...cardsFor(ITEMS, cardReqs[i]!.pool.kind, p.ids)));
    }
    const offer = offerKind ? { cards } : null;
    const portals = answered?.portals ?? null;

    if (stage === "boss" && !atBoss)
      atBoss = {
        spells: slots.flatMap((x, i) => (x ? [{ id: x.base, level: spellLevels[i] ?? 1, affixes: (spellAffixes[i] ?? []).map((a) => `${a.id}${a.tier}`) }] : [])),
        stats: statsTaken, hearts, gold,
      };
    const world = createWorld({
      room: plan, encounter: planned?.plan.encounter ?? null, staff, slots,
      hearts, rng: src.stream("gameplay", index), mods, rage,
      strayElite: stage === "combat" && !elite ? strayEliteFor(index, src.stream("stray", index)) : [],
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
      const boss = makeEnemy(1, "boss", (GRID_W / 2) * TILE_PX, (GRID_H / 2) * TILE_PX, []);
      boss.spawnFadeMs = 0;
      boss.awake = true;
      world.enemies.push(boss);
    }

    traceRoom(seed, index);
    // The last stop mends, as it does in the scene.
    if (stage === "shop") world.player.hearts = Math.min(MAX_HEARTS + mods.maxHearts, world.player.hearts + PREBOSS_MEND_HEARTS);
    if (stage !== "shop") {
      const key = stage === "boss" ? "boss" : roomType;
      WAVES.set(key, [...(WAVES.get(key) ?? []), 1 + world.pendingWaves.length]);
    }
    const result = stage === "shop"
      ? { cleared: true, heartsLost: 0, ms: 0, enemiesKilled: 0 }
      : fight(world, stage === "boss" ? BOSS_TIMEOUT_MS : ROOM_TIMEOUT_MS);
    hearts = world.player.hearts;
    rage = world.player.rage;
    heartsLostRecent = result.heartsLost;
    lastClearMs = result.ms;
    totalMs += result.ms;
    // Doc 003's economy: a clear pays, an elite pays more.
    if (stage === "combat") gold += elite ? 28 : 12;
    const grade = stage === "combat" ? door.grade : 1;

    let reward: string | null = null;
    if (hearts > 0 && result.cleared && offerKind) {
      if (offer && offer.cards.length === 0) {
        // A gold room scatters coins; the sum is what the scene pays.
        gold += GOLD_CARD_VALUE * 2 * grade;
        reward = "gold";
      } else if (offer) {
        const card = chooseCard(offer.cards, hearts, stage === "shop" ? gold : null);
        if (card) {
          if (stage === "shop") gold -= SHOP_PRICE[card.kind] ?? 0;
          reward = card.label;
          if (card.kind === "stat") {
            statsTaken++;
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
            let at = world.spells.findIndex((x) => x?.affixes.some((a) => a.id === card.itemId));
            if (at < 0) at = world.spells.findIndex((x) => x && x.affixes.length < AFFIX_SLOTS);
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
     * The blacksmith, after the merchant: what gold is left raises the
     * lowest-level key first, as a player readying for the boss would. The
     * reference player never used the smith, so the harness measured a boss
     * fought without the one purchase that stop exists for.
     */
    if (stage === "shop") {
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

    rooms.push({
      index, type: roomType, space: plan.params.space, tension,
      cleared: result.cleared, heartsLost: result.heartsLost, ms: Math.round(result.ms),
      enemies: result.enemiesKilled, rewardKind: offerKind, reward,
      shape: planned?.plan.encounter
        ? {
            density: planned.plan.encounter.profile.density,
            waves: planned.plan.encounter.profile.wave_structure,
            roster: planned.plan.encounter.waves.reduce((a, w) => a + w.spawns.reduce((b, x) => b + x.count, 0), 0),
          }
        : null,
      sources: planned ? [planned.source.params, planned.source.encounter] : ["fixed", "none"],
    });

    rooms_.push(roomType);
    tensions_.push(tension);
    spaces_.unshift(plan.params.space);
    if (plan.skeleton) skeletons_.unshift(plan.skeleton);
    if (planned?.profile) profiles_.push(planned.profile);
    scores_.push("neutral");
    if (!result.cleared) break;
    if (stage === "boss") break;

    // The way out: the Director still sets the next tension, and the portals
    // are the two-axis offer doc 003 describes. The player picks by currency.
    const doors = await director.planDoors(context(
      seed, index, hearts, gold, staff, slots, inventory, history(), preset, lastClearMs, heartsLostRecent,
    ));
    tension = doors.tension;
    lastWasElite = elite;
    // The reference player fights every room: a vendor's door is not taken.
    const offered = (portals?.doors ?? []).filter((d) => !d.npc);
    door = offered.length > 0
      ? choosePortal(offered, hearts, world.spells.filter(Boolean).length)
      : { reward: "stat", difficulty: "normal", grade: 1 };
  }

  return {
    seed, arm, rooms,
    survived: hearts > 0,
    heartsLeft: hearts,
    totalMs: Math.round(totalMs),
    items: slots.flatMap((s) => (s ? [s.base] : [])),
    atBoss,
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
function choosePortal(offered: readonly DoorOffer[], hearts: number, spellsHeld: number): DoorOffer {
  const by = (k: RewardCardKind) => offered.find((d) => d.reward === k);
  // Hurt: the stat door, because `Vigour` lives there.
  if (hearts <= MAX_HEARTS / 2 && by("stat")) return by("stat")!;
  // A free key: fill it.
  if (spellsHeld < 3 && by("spell")) return by("spell")!;
  // Healthy and equipped: take an elite if one is offered, otherwise an affix.
  const elite = offered.find((d) => d.difficulty === "elite");
  if (hearts >= MAX_HEARTS - 1 && elite) return elite;
  return by("affix") ?? by("spell") ?? by("stat") ?? offered[0]!;
}

/**
 * How the reference player picks a card. Hurt takes healing if it is there;
 * otherwise the first card, which is the pool's own ordering and therefore not
 * a preference the chooser invented. With a price list it takes the first it
 * can afford.
 */
function chooseCard(cards: readonly OfferCard[], hearts: number, gold: number | null): OfferCard | null {
  const affordable = cards.filter((c) => gold === null || gold >= (SHOP_PRICE[c.kind] ?? 0));
  if (affordable.length === 0) return null;
  if (hearts <= MAX_HEARTS / 2) {
    const heal = affordable.find((c) => c.itemId === "vigour");
    if (heal) return heal;
  }
  return affordable[0]!;
}

/** The scene's price list. Doc 003's economy: 15 / 30 / 50 by rarity. */
const SHOP_PRICE: Readonly<Record<string, number>> = { stat: 20, affix: 30, spell: 45, gold: 0 };

/**
 * The two rooms that are not encounters, built the way the scene builds them.
 * The merchant gets any open arena; the boss gets its own archetype.
 */
function fixedRoom(stage: "shop" | "boss", rng: ReturnType<RngSource["stream"]>) {
  const space = stage === "boss" ? BOSS_ARCHETYPES[0]!.id : "open_arena";
  const g = generateRoom(
    { space, symmetry: "mirrored", mood: { temperature: "cold", brightness: "dim", particle_intensity: "calm" } },
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

function fight(world: World, timeoutMs = ROOM_TIMEOUT_MS): { cleared: boolean; heartsLost: number; ms: number; enemiesKilled: number } {
  let killed = 0;
  let ms = 0;
  let peakBullets = 0;
  let bulletSum = 0;
  let samples = 0;
  // Counted so a timeout can say whether the model was attacking at all.
  let swings = 0;
  while (ms < timeoutMs && world.player.hearts > 0) {
    const before = world.player.swingMs;
    const input = referenceInput(world);
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
    step(world, input);
    if (before <= 0 && world.player.swingMs > 0) swings++;
    // What is taking the hearts, not just how many. "Too hard" is not
    // actionable; "half the damage is contact from chasers" is.
    for (const ev of world.events)
      if (ev.kind === "player_hit" && ev.amount !== 0) {
        // The whole cause, archetype included: "contact" alone does not say
        // whether a chaser landed a lunge or a turret was walked into.
        const cause = ev.what ?? "unknown";
        HURT_BY.set(cause, (HURT_BY.get(cause) ?? 0) + 1);
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
            });
          }
        }
      }
    killed += world.events.filter((e) => e.kind === "enemy_killed").length;
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
  return { cleared, heartsLost: world.stats.heartsLost, ms, enemiesKilled: killed };
}

function context(
  seed: string, index: number, hearts: number, gold: number, staff: Staff,
  slots: readonly (ItemInstance | null)[], inventory: readonly ItemInstance[],
  history: RunHistory, preset: Archetype, lastClearMs: number, heartsLostRecent: number,
): RunContext {
  const sim = simulateStaff(staff, slots, ITEMS);
  return {
    run_id: seed, seed, room_index: index,
    labels: {
      health: bucketHealth(hearts),
      recent_damage: bucketRecentDamage(heartsLostRecent),
      clear_speed: bucketClearSpeed(lastClearMs, 30_000),
      movement_pressure_recent: bucketMovementPressure(0.5),
      run_progress: bucketRunProgress(index),
      gold: bucketGold(gold),
      tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
      build: {
        archetype: sim.archetype, bottleneck: sim.bottleneck,
        mana_sustain: sim.mana_sustain, range: "mid",
        missing_roles: sim.missing_roles, dominant_tags: sim.dominant_tags,
      },
      preference: { dominant: sim.dominant_tags.slice(0, 3), consistency: "on_plan" },
    },
    staff, slots, inventory, history, intent: { preset },
  };
}
