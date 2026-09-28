/**
 * The **run-progress ramp** (doc 005, "The room's beat structure"; doc 014).
 *
 * A room is a handful of **beats**, not a stream. Hades' chambers are one to
 * three waves and each one is a statement — the first sets the scene, the
 * next adds a threat the first did not have, the last is the climax — and a
 * fight that keeps trickling is a fight with no shape to remember. Six waves
 * and an uncapped late-run count was measured and reported as exhausting.
 *
 * And a room at index 1 is not a room at index 13. The caps that hold a
 * fight's size were written for the late run; applied from the first door
 * they handed room 1 a seventeen-body trickle, which is unplayable before
 * there is a build to play it with. So the table ramps three things together
 * — how many beats, how big a beat is, and how many may stand at once:
 *
 * | rooms | waves | bodies per wave | total | alive at once | subspecies | hit damage | aim miss | shot speed | body health | body damage | turn rate |
 * |---|---|---|---|---|---|---|---|---|---|---|---|
 * | 1–2 | 2 | 5, climax +2 | 12 | 4 | no | ×0.8 | ±9° | ×0.9 | ×1.5 | ×1 | ×1.35 |
 * | 3–5 | 2 | 5, climax +3 | 13 | 5 | yes | ×0.8 | ±8° | ×0.95 | ×1.5 | ×1 | ×1.25 |
 * | 6–9 | 3 | 5, climax +1 | 16 | 6 | yes | ×1 | ±6° | ×1 | ×1.75 | ×1.25 | ×1.14 |
 * | 10–13 | 3 | 6, climax +1 | 19 | 6 | yes | ×1 | ±4° | ×1 | ×1.95 | ×1.45 | ×1.14 |
 * | 14–15 | 3 | 6, climax +2 | 20 | 6 | yes | ×1 | ±4° | ×1 | ×2.2 | ×1.65 | ×1.2 |
 * | 16 (boss) | 3 | 6, climax +2 | 20 | 6 | yes | ×1 | ±4° | ×1 | ×2.2 | ×2.05 | ×1 |
 *
 * **The total is the Director's; the crowd is the ramp's.** The room totals
 * sit above every density's target (sparse 5–7, normal 9–12, dense 14–18),
 * so the density Jev picks is the density the room gets; what keeps an
 * opening room gentle is how many stand at once, the hit's cost and the
 * tells. A room-1 total of four sat under even `sparse`, so every early
 * room was four bodies whatever was chosen.
 *
 * The early softening was cut to about three quarters (aim ±14° → ±11°,
 * shots ×0.8 → ×0.85, tells ×1.5 → ×1.38 in rooms 1–2) once the browser
 * really ran room 1 as room 1: it had been tuned while every browser room was
 * room 99, and played as too easy.
 *
 * ### The pass that raised the whole table
 *
 * A real logged session of the fixed build — sixteen rooms, won, nothing at
 * all lost in rooms 1 to 3 — was fitted into the `player` skill profile, and
 * measured against it the run was still a walk: 7.3 health a room, two fights
 * in five costing nothing whatever, and every run that reached the boss
 * beating it. The user's words were "enemy HP and attack frequency probably
 * both need to go up", and those are the two columns that moved.
 *
 * **Health** is the `hp` column, which used to be ×1 for the first five rooms
 * and only reached ×1.7 at the end. It starts at ×1.5 now, so a room-1 rusher
 * is four sword swings and three casts of a starting spell rather than three
 * and two, and climbs more gently on top of that. **Attack frequency** is the
 * `rate` column, which is new; see its own note below.
 *
 * The early softening came down with it — aim ±11° → ±9°, shots ×0.85 → ×0.9,
 * tells ×1.38 → ×1.28 — so that rooms 1 to 3 cost something. What did **not**
 * move is `hurt`: the user asked for the early hit to stay at 0.8 of its
 * damage, and it has.
 *
 * Measured on `player` over thirty seeds of the rule arm, that is 4.7 / 5.4 /
 * 8.6 health in rooms 1 to 3 (they were 4.8 / 1.1 / 1.8), about 10 a room
 * through the middle, 1.6 hearts in an elite room, and 14 of 30 runs won.
 *
 * The first five columns **soften the opening**; the last two **harden the
 * end**, and they are the half that was missing. Everything else in the table
 * reaches 1 by room 10 and stops, so a body in room 14 was the body the
 * player met in room 6 while the build that meets it has three keys, a dozen
 * levels and six affixes. Only one side of the fight was growing.
 *
 * The **climax** is the last wave of a room from the mid run on: it may carry
 * two bodies over its band, and it is where the heaviest of the roster goes.
 * It never puts more than six on the floor at once, though — the gate holds
 * the rest until there is room, so a climax is a heavier beat rather than a
 * bigger crowd.
 * A later wave is never just more of the same — the bodies a room was given
 * are dealt lightest-first, so each beat is heavier than the one before it.
 *
 * **The lists are bounds, not decisions.** The user's standing principle is
 * that Jev decides and code only says what is safe, so every step offers at
 * least two densities: the body caps above are what make "normal" in room 1
 * safe — it still means at most four bodies at once — so the label is the Director's
 * to choose and the size is not. The one exception is the anchor in rooms 1
 * and 2, where a tank is the whole fight at four bodies at once: there the
 * single option stands, and the Director's own guard drops a question with
 * nothing to decide.
 *
 * It is a **hard filter, not a preference**, applied at the world — the last
 * place before the bodies exist — so whatever either arm chose and whatever
 * fallback preset it reached, an early room is a small room and no room is a
 * stream. Doc 002 asks that code remove illegal options before either arm
 * answers, which `rampDensities` and `rampAnchors` are for; the clamps are
 * the floor under that, so the guarantee does not depend on the asking.
 *
 * By room index rather than by tension, because tension is how hard *this*
 * room should feel and this is how much game the player has had: a peak room
 * at index 2 should still be the hardest of the opening rooms, and small.
 */
import type { Density, ElitePresence, EnemyId } from "../types.ts";

export interface Ramp {
  /** Beats the fight is told in. Never more; a longer plan is cut to this. */
  readonly waves: number;
  /** Bodies in one beat, and the extra the climax beat may carry. */
  readonly perWave: number;
  readonly climaxBonus: number;
  /** Bodies standing at once, which is the figure the player feels. */
  readonly alive: number;
  /** The densities and anchors the Director may be offered at this point. */
  readonly densities: readonly Density[];
  readonly anchors: readonly ("none" | "tank" | "summoner")[];
  /** Whether an elite room may be drawn at all. */
  readonly elites: boolean;
  /**
   * Whether **subspecies** may be drawn — the lancer today, and whatever doc
   * 019 adds. A subspecies is a known body with one rule changed, so it only
   * reads as that once the player has met the body it changes: the lancer's
   * lingering, bursting spikes are the rusher's stab plus a second question,
   * and asking it before the first is learned is asking both at once.
   */
  readonly subspecies: boolean;
  /** Attack and firing turns a room starts from, before the per-body scaling. */
  readonly tokens: number;
  /**
   * What an enemy's hit costs the player here, as a multiple of its full
   * damage. The opening rooms are where the player learns the enemies'
   * telegraphs, and a hit taken while learning should not decide the run:
   * a playtest lost 23 of 60 health in room 1, which the reference player
   * clears untouched. Full from the mid run, where the build answers it.
   *
   * **Only a fifth off now, and full from room 6.** That playtest ran every
   * room as room 99 (the game never passed `roomIndex`), so the ×0.5 answered
   * a bug; once the early aim, speed and tell softening reached the browser,
   * a halved hit read as 1–2 damage and the opening rooms as too easy. Full
   * damage everywhere was a shade too far (the user's call: 0.8).
   */
  readonly hurt: number;
  /**
   * How far an aimed volley may miss, either way, in degrees, and how fast
   * enemy shots fly, as a multiple of their own speed. Aimed fire was exact
   * from the first door — a volley at where the player stood a beat ago, at
   * full speed — and a few ranged bodies closed every line out before the
   * player had learned to strafe ("too accurate, easily boxed in by
   * bullets"). A volley misses as one, so a fan keeps its shape and its gaps.
   */
  readonly aimSpreadDeg: number;
  readonly shotSpeed: number;
  /**
   * How much longer a melee body's windup runs early in the run.
   *
   * The ramp already softens what a hit costs (`hurt`) and how well a shot is
   * aimed (`aimSpreadDeg`); a melee tell is the third thing a player has to
   * learn and it was the one left at full speed. Measured on the humanised
   * novice profile, the rusher was **30% of every heart lost** and the run
   * ended around room 3 — a 275 ms tell is inside a new player's reaction
   * time once they are also reading the floor. The shape of the attack does
   * not change; the announcement is longer while the run is young.
   */
  readonly tell: number;
  /**
   * What the bodies in this room are worth, as multiples of their roster
   * health and their roster damage.
   *
   * **The one thing the run had no ramp for was the run itself.** Everything
   * above softens the *opening*, and past room 5 every figure is 1: a body in
   * room 14 was exactly the body the player met in room 6, while the build
   * that meets it has three spells, a dozen levels and six affixes. A full
   * clear was measured at 24 of 60 health lost over sixteen rooms — the
   * player was never in danger after the first third — and the reason is that
   * only one side of the fight grows.
   *
   * So the late run scales what a body is. Health first, because health is
   * what a build converts into time and it is the figure that never surprises
   * anybody mid-attack; damage second and more gently, because a hit that
   * costs more is a hit that costs more whether or not it was readable, and
   * doc 019's fairness rule holds here as it does for elites: **no telegraph
   * is ever shortened by this.** The player's answers all still work; they
   * cost more when they are missed, and the fight takes longer to close.
   *
   * Set against the measured curve rather than picked: rooms 6 to 9 cost the
   * average profile about one heart, rooms 10 to 14 about half of one, and a
   * run reached the boss at nearly full health with hearts to spare.
   *
   * **And then the whole column moved up.** The curve above was right about
   * its shape and wrong about its floor: a body in room 1 was still worth
   * exactly its roster health, so the opening rooms cost the fitted `player`
   * profile nothing at all and the middle of the run cost five or six health
   * a room. It starts at ×1.5 now. What holds the bottom of it is the sword
   * and the starting spells: `spell-bench` asserts that a room-1 body is
   * three to five swings and that a starting spell kills it in two or three
   * casts, and at ×1.5 those are four and three — which is the "toward three"
   * the user asked for and the reason the figure is not higher.
   *
   * ### And then the late half moved again, for the levels
   *
   * Doc 003 gave the player a level: kills pay experience and the bar reaches
   * the boss at 90 health rather than 60, with a sword hitting for 15 rather
   * than 9. Measured, that took the fitted `player` profile from 45% of runs
   * won to **100%** — and by more than the bar alone explains, because the
   * fountain at the fixed stop refills half of it and an elite's heal is a
   * tenth of it, so every source of recovery grew with the maximum too.
   *
   * So the late bands answer it: health ×1.52 / ×1.62 / ×1.78 →
   * ×1.75 / ×1.95 / ×2.2 and damage ×1.1 / ×1.2 / ×1.3 → ×1.25 / ×1.45 / ×1.65
   * over rooms 6–9, 10–13 and 14–15. **The opening bands are untouched**,
   * because the opening is played at level 1 or 2 and `spell-bench` still
   * measures a room-1 body against a level-1 sword.
   *
   * **The boss band's `power` is ×2.05, and it reaches the king himself.**
   * Every death in a measured run happens in his hall, and the fountain means
   * the health a player arrives on is very nearly their maximum whatever the
   * fourteen fights cost — so a bar that grew by half against blows that did
   * not is the whole fight rebalanced by the back door. `stepBoss` reads this
   * column now, which the band below always said it should ("only the beat is
   * the boss's"). His **health** is not scaled: that would make the fight
   * longer rather than harder, and its length is doc 020's. Back to 55% won.
   */
  readonly hp: number;
  readonly power: number;
  /**
   * **How often a body takes its turn**, as a multiple of the roster's own
   * cadence: the gap after a melee attack is divided by it and the clock a
   * ranged pattern runs on is multiplied by it.
   *
   * The other half of the answer to "the fights are easy". Health alone makes
   * a room *longer* — the player stands in the same thin rain of fire for
   * more seconds — and a longer fight against a quiet room is a chore rather
   * than a fight. What the player asked for was both: bodies that take more
   * killing **and** bodies that ask more often while being killed. Measured
   * at the fitted `player` profile, the roster spent 15 to 20% of its awake
   * time attacking and 0.24 bodies were attacking at any instant; a room
   * whose bodies are dangerous a fifth of the time is a room the player walks
   * around.
   *
   * It is a **cadence**, not a telegraph: every windup, marker and aim keeps
   * its own length, so nothing here shortens the announcement below doc 005's
   * 250 ms floor. What changes is how soon the next announcement starts.
   *
   * The boss is exempt. It runs its own phase pace (`BossPhase.rate`) and is
   * being redesigned separately; a run-progress multiplier on top of that
   * would be tuning it by the back door.
   */
  readonly rate: number;
  /**
   * **How much of a body's poise it has here** (doc 027), on top of the room's
   * `hp`, which it already follows. The opening rooms soften it as they
   * soften the tells: a room-1 rusher is broken by two swings of a level-1
   * sword, and the long tells there are what let a new player read what a
   * blow held through means before it costs them. Whole from room 6.
   */
  readonly poise: number;
}

const STEPS: readonly (Ramp & { from: number })[] = [
  {
    from: 0, waves: 2, perWave: 5, climaxBonus: 2, alive: 4,
    densities: ["sparse", "normal"], anchors: ["none"], elites: false, subspecies: false, tokens: 1, hurt: 0.8, aimSpreadDeg: 9, shotSpeed: 0.9, tell: 1.28, hp: 1.5, power: 1, rate: 1.35, poise: 0.6,
  },
  {
    from: 3, waves: 2, perWave: 5, climaxBonus: 3, alive: 5,
    densities: ["sparse", "normal", "dense"], anchors: ["none", "tank"], elites: false, subspecies: true, tokens: 2, hurt: 0.8, aimSpreadDeg: 8, shotSpeed: 0.95, tell: 1.2, hp: 1.5, power: 1, rate: 1.35, poise: 0.8,
  },
  {
    from: 6, waves: 3, perWave: 5, climaxBonus: 1, alive: 6,
    densities: ["sparse", "normal", "dense"], anchors: ["none", "tank", "summoner"], elites: true, subspecies: true, tokens: 2, hurt: 1, aimSpreadDeg: 6, shotSpeed: 1, tell: 1.12, hp: 1.75, power: 1.25, rate: 1.45, poise: 1,
  },
  {
    from: 10, waves: 3, perWave: 6, climaxBonus: 1, alive: 6,
    densities: ["sparse", "normal", "dense"], anchors: ["none", "tank", "summoner"], elites: true, subspecies: true, tokens: 3, hurt: 1, aimSpreadDeg: 4, shotSpeed: 1, tell: 1, hp: 1.95, power: 1.45, rate: 1.6, poise: 1,
  },
  {
    from: 14, waves: 3, perWave: 6, climaxBonus: 2, alive: 6,
    densities: ["sparse", "normal", "dense"], anchors: ["none", "tank", "summoner"], elites: true, subspecies: true, tokens: 3, hurt: 1, aimSpreadDeg: 4, shotSpeed: 1, tell: 1, hp: 2.2, power: 1.65, rate: 1.75, poise: 1,
  },
  /*
   * **The boss room, which is the boss's fight and not the ramp's.**
   *
   * Identical to the band above but for the cadence, which goes back to the
   * roster's own. The boss body was already exempt (`turnRate`), but the adds
   * it calls in are made through `rampFor(roomIndex)` like any other body, so
   * a run-progress multiplier on their turns is a change to how hard the boss
   * fight is — and the boss is owned elsewhere. Health and damage keep the
   * late-run figures, as they always did; only the beat is the boss's.
   */
  {
    from: 16, waves: 3, perWave: 6, climaxBonus: 2, alive: 6,
    densities: ["sparse", "normal", "dense"], anchors: ["none", "tank", "summoner"], elites: true, subspecies: true, tokens: 2, hurt: 1, aimSpreadDeg: 4, shotSpeed: 1, tell: 1, hp: 2.2, power: 2.05, rate: 1, poise: 1,
  },
];

/** The boss band, which is never blended into: see its own note. */
const BOSS_FROM = 16;

/**
 * The ramp at a room index (1-based, as doc 003 numbers the run).
 *
 * **Every room a little harder than the last, not a step every few rooms.**
 * The rows above are anchors at the room each band starts in, and the figures
 * that are amounts — health, damage, cadence, tell, aim, shot speed, the hit's
 * cost, poise, the turns a room has — run in a straight line from one anchor to the
 * next. As steps, rooms 6 to 9 were one room four times and room 10 a jump;
 * the player's build grows every room, so the fight should too. What is a
 * shape rather than an amount — how many beats, how big a beat, how many may
 * stand at once, which densities, anchors, elites and subspecies may be
 * offered — keeps its band, because half a beat is not a thing.
 *
 * `tokens` is a count, so it is the line rounded down: a room has its next
 * turn only once it has reached it. Rooms 14 and 15 hold the last band's
 * figures, and the boss band is taken exactly: the boss is owned elsewhere
 * and nothing is blended into it.
 */
export function rampFor(roomIndex: number): Ramp {
  let at = 0;
  for (let k = 0; k < STEPS.length; k++) if (roomIndex >= STEPS[k]!.from) at = k;
  const s = STEPS[at]!;
  const next = STEPS[at + 1];
  if (!next || next.from >= BOSS_FROM) return s;
  // The first band's anchor is room 1, the first room played, not index 0.
  const from = Math.max(1, s.from);
  const t = Math.max(0, Math.min(1, (roomIndex - from) / (next.from - from)));
  const lerp = (a: number, b: number): number => a + (b - a) * t;
  return {
    ...s,
    tokens: Math.floor(lerp(s.tokens, next.tokens) + 1e-9),
    hurt: lerp(s.hurt, next.hurt),
    aimSpreadDeg: lerp(s.aimSpreadDeg, next.aimSpreadDeg),
    shotSpeed: lerp(s.shotSpeed, next.shotSpeed),
    tell: lerp(s.tell, next.tell),
    hp: lerp(s.hp, next.hp),
    power: lerp(s.power, next.power),
    rate: lerp(s.rate, next.rate),
    poise: lerp(s.poise, next.poise),
  };
}

/** Bodies the whole room may hold: its beats, the last one a climax. */
export function rampRoster(roomIndex: number): number {
  const r = rampFor(roomIndex);
  return r.waves * r.perWave + r.climaxBonus;
}

/**
 * The fewest bodies a combat or elite room may hold.
 *
 * A room that is a fight in the plan and empty on the floor is a free reward
 * room, and the player met one. The sweep found no wholly empty rooms after
 * the beat-dealing fix, but two of five hundred and eleven were assembled
 * with a roster of **two**, which is the same thing with a fig leaf: the
 * assembler's own floor ("fewer than six bodies is re-staged as a trickle",
 * doc 005) does not always hold once a band clamps the count.
 *
 * So the world guarantees it instead, at the last place before the bodies
 * exist. Four, or the whole of an opening room's single beat, whichever is
 * smaller — the point is that a fight is a fight, not that it is a big one.
 */
export function rampMinimum(roomIndex: number): number {
  return Math.min(4, rampFor(roomIndex).perWave);
}

/**
 * The archetypes the ramp forbids at this point: the subspecies, until the
 * player has met the bodies they are variants of. A **hook for doc 019** —
 * the subspecies agent adds its ids here rather than threading a new rule
 * through the assembler.
 */
export const SUBSPECIES: readonly EnemyId[] = [
  "lancer",
  /*
   * Doc 019's thirteen, one per remaining base. The **order is the unlock
   * order**: the five light ones first, then the six that ask more of a room,
   * then the two heavies, which `SUBSPECIES_FROM` reads off as room indices.
   */
  "pinner", "watcher", "burrower", "emberling", "wisp",
  "beacon", "quaker", "chainer", "planter", "pealer", "fusilier",
  "breaker", "brooder",
];

/**
 * The room a subspecies may first appear in.
 *
 * Not one gate for all of them, because they are not one weight: a pinner is
 * the shooter's lane asked twice and a brooder rewrites where a summoner's
 * reinforcements land. The `subspecies` flag above is the floor under this —
 * nothing before room 3 — and this is the stagger on top, so the player meets
 * the tier a few bodies at a time rather than all at once in room 3.
 */
const SUBSPECIES_FROM: Readonly<Partial<Record<EnemyId, number>>> = {
  lancer: 3, pinner: 3, watcher: 3, burrower: 3, emberling: 3, wisp: 3,
  beacon: 6, quaker: 6, chainer: 6, planter: 6, pealer: 6, fusilier: 6,
  breaker: 10, brooder: 10,
};

export function rampAllows(roomIndex: number, id: EnemyId): boolean {
  if (!SUBSPECIES.includes(id)) return true;
  return rampFor(roomIndex).subspecies && roomIndex >= (SUBSPECIES_FROM[id] ?? 3);
}

/**
 * The subspecies this point in the run unlocks, for the Director's slot
 * questions (doc 019). The option list is narrowed further to those whose base
 * is actually in the roster, so a room offers three to five rather than
 * fourteen — the length that measured well on the live model.
 */
export function rampSubspecies(roomIndex: number): readonly EnemyId[] {
  return SUBSPECIES.filter((id) => rampAllows(roomIndex, id));
}

/**
 * The `elite_presence` options this point in the run may be offered (doc 019).
 *
 * The hard caps are code's and stay code's: none before the ramp allows an
 * elite at all, and never more than two in a normal room. Inside that, how
 * many a room hides is the Director's, because it reads on the player's state
 * exactly as `density` and `anchor` do. Two options at every step that offers
 * any, so there is always something to decide.
 */
export function rampElitePresence(roomIndex: number): readonly ElitePresence[] {
  if (!rampFor(roomIndex).elites) return ["none"];
  return roomIndex >= 10 ? ["none", "one", "two"] : ["none", "one"];
}

/** The densities code may offer at this point in the run (doc 002). */
export function rampDensities(roomIndex: number): readonly Density[] {
  return rampFor(roomIndex).densities;
}

/** The anchors code may offer at this point in the run. */
export function rampAnchors(roomIndex: number): readonly ("none" | "tank" | "summoner")[] {
  return rampFor(roomIndex).anchors;
}
