/**
 * How good the reference player is (design doc 011, "Skill profiles").
 *
 * The reference player was one fixed opponent, and it was a very good one: it
 * re-planned sixteen directions every frame against every bullet in the room,
 * aimed perfectly, never hesitated and never lost track of anything. Measured
 * against a human that is not a small gap — the model cleared the first room in
 * about five seconds at no cost, where the person who wrote the game took two
 * minutes and lost a third of their health to it. Every band the harness
 * reports was therefore measured against somebody nobody is.
 *
 * A `SkillProfile` is the set of human limits the model is allowed to have. The
 * limits are **parameters, not noise sources in disguise**: every one of them is
 * either a clock (a reaction, a re-plan interval, a delay before a key) or a
 * bounded budget (how many threats are attended to, how far off an aim may be),
 * and the only randomness is drawn from a hash of the world's own tick. The
 * harness stays deterministic per seed, which is what the replay, the seeded
 * runs and every regression comparison depend on.
 *
 * `expert` is today's model, exactly: every clock at zero, every budget
 * unbounded, the same 230 ms reaction. Existing numbers reproduce under it, so
 * it stays the profile the harness asserts on.
 */

/** The named presets. `expert` is the model as it was before profiles existed. */
export const SKILL_NAMES = ["novice", "average", "player", "expert"] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export interface SkillProfile {
  readonly name: SkillName;

  /**
   * How far behind the simulation the player's eyes and hands are, in ms.
   *
   * Simple visual reaction time is about 200 to 250 ms, and the design
   * documents size the lightning marker and the locked part of an enemy windup
   * against a 250 ms floor. A practised player sits at the bottom of that band;
   * somebody who has not learned what a telegraph means sits above it, because
   * recognising the shape is part of the delay.
   */
  readonly reactionMs: number;
  /**
   * Extra lag on anything **behind the player or off the screen**.
   *
   * A person's attention is where they are looking. A bullet crossing in front
   * is seen at `reactionMs`; one fired at their back is seen when it arrives,
   * or when they next sweep the room. Modelled as a second, deeper delay for
   * exactly those threats rather than as a blanket slowdown, because the
   * failure it produces — being shot from behind while handling what is in
   * front — is the one real players actually report.
   */
  readonly blindSpotMs: number;

  /**
   * How often the movement plan is redone, in ms. Zero means every frame.
   *
   * This is the single largest difference between the model and a person.
   * Re-scoring sixteen directions at 60 Hz means the model can reverse into a
   * gap that opened one frame ago; a human commits to a dodge and lives with
   * it for a beat. Holding the chosen direction between decisions is what makes
   * a room take a minute instead of five seconds.
   */
  readonly decisionMs: number;

  /**
   * How many bullets the model prices at once, nearest first.
   *
   * Attention is finite and bullet-hell rooms are explicitly built to overflow
   * it. With every bullet scored, a wall of fire has a computable gap; with
   * three, the fourth bullet is the one that hits.
   */
  readonly attentionBullets: number;
  /** The same budget for bodies: how many enemies' blades and telegraphs are tracked. */
  readonly attentionEnemies: number;

  /**
   * How far off the aim may be, in degrees, on a spell.
   *
   * Held for as long as the target is held, rather than redrawn per frame, so
   * it reads as a player who is aiming slightly wrong rather than as a hand
   * that shakes at 60 Hz.
   */
  readonly aimErrorDeg: number;
  /**
   * How long the model stays committed to a target before it will swap to a
   * nearer one. Switching instantly is free re-planning by another name: it
   * lets the model carve through a crowd in whatever order is optimal at each
   * instant, which is not how a person fights a crowd.
   */
  readonly targetSwitchMs: number;
  /**
   * Fractional error in how a bullet's velocity is read, so the predicted path
   * is a little wrong. A person extrapolates a trajectory by eye; at 0.25 the
   * predicted position a quarter-second out is off by a quarter of the
   * distance travelled, which is roughly a body's width at typical speeds.
   */
  readonly velocityErr: number;

  /**
   * Standing still at the door reading the room, in ms. A new player stops and
   * looks at what is in the room before moving into it; the model charged
   * straight in from frame one. Costs nothing but time, which is the point:
   * room length is half of what is being calibrated.
   */
  readonly entryIdleMs: number;
  /**
   * How long the model is flustered after being hit, in ms: no new movement
   * plan, no swing, no cast. Being hit is the moment a person's plan falls
   * apart, and chains of hits are most of what a bad run is made of.
   */
  readonly recoverMs: number;

  /**
   * How long after a spell becomes castable before the key is pressed, and the
   * minimum gap the model leaves between casts. The model pressed every key on
   * the frame it came off cooldown, which is a rotation nobody runs. A slower
   * rotation is less damage per second, which is longer rooms, which is more
   * time under fire — the effect compounds, so it is worth a real parameter.
   */
  readonly castReactionMs: number;
  readonly castGapMs: number;

  /**
   * How late the dash is spent, and how often it is not spent at all.
   *
   * The model dashes the instant the best available step is still dangerous,
   * which is the theoretically correct moment. People dash late — after the
   * shot is already on them — or panic-dash and do not have it when it
   * mattered. `dashSkipChance` is the share of those correct moments that go
   * unused; the roll is seeded, so a given seed always skips the same ones.
   */
  readonly dashDelayMs: number;
  readonly dashSkipChance: number;

  /**
   * How sloppily the spacing band is held, in px, either way.
   *
   * There is a band about fifteen px wide where the player's arc lands and the
   * enemy's does not, and standing in it is the whole skill of the melee
   * matchup. Being off by twenty px is not being slightly worse at this; it is
   * standing inside the blade, or outside your own. Seeded per target, so it is
   * a habit for the duration of a fight rather than a jitter at 60 Hz.
   */
  readonly spacingSlopPx: number;
  /**
   * How far **outside** the band the player prefers to stand, in px.
   *
   * Timidity, and it is the parameter that most changes how long a room takes.
   * A new player hovers at what they guess is the edge of their reach, because
   * getting closer feels like getting hit — so they whiff, the body does not
   * die, and they spend the whole fight in the open being shot at by everything
   * else. It is also self-correcting in the model, the way it is in a person:
   * the patience rule notices nothing is dying and walks them in, they get hit,
   * and they back off again. That cycle is what a two-minute first room looks
   * like from the outside.
   */
  readonly timidityPx: number;
  /**
   * How far the player backs away from **any** body, in px, regardless of
   * whether it can actually reach them.
   *
   * The reference player prices only the blade: contact damage does not exist
   * in this game, so standing next to a turret is free, and the model knows it.
   * A beginner does not. They read a body as dangerous and give it room, which
   * is why a new player's first rooms are spent circling an open floor — and
   * why they are spent being shot, since backing out of everything's reach puts
   * them in the open with no cover and nothing dying.
   *
   * This is the parameter that makes the novice's damage mostly ranged, which
   * is the shape the one real session shows. Zero for anyone who has learned
   * that bodies are harmless.
   */
  readonly bodyFearPx: number;

  /**
   * How long the model dithers before throwing a swing that is already on, in
   * ms.
   *
   * The model swung on the first frame a body was inside the arc it happened to
   * be facing, which is not a decision anybody makes — it is the absence of
   * one. A beat of delay is not only slower, it **misses**, because the body
   * and the player both keep moving during it. Mistimed swings are most of why
   * a beginner's damage is so much lower than their swing count suggests.
   */
  readonly swingReactionMs: number;
}

/**
 * The presets.
 *
 * `player` is the fitted one: a real logged run of the build that shipped.
 * `novice` and `average` are **provisional** — both were fitted to sessions
 * recorded while the browser ran every room as room 99 (full waves, ×1.7 body
 * health, no early softening), which makes them weaker than the players they
 * name. They are kept as reference points and refit with `pnpm play:calibrate`
 * once logs from the fixed build exist.
 */
export const SKILL_PROFILES: Readonly<Record<SkillName, SkillProfile>> = {
  /**
   * The model as it was before profiles existed. Every clock at zero and every
   * budget unbounded, so the harness's existing assertions and every number
   * already published reproduce exactly under it.
   */
  expert: {
    name: "expert",
    reactionMs: 230,
    blindSpotMs: 0,
    decisionMs: 0,
    attentionBullets: Infinity,
    attentionEnemies: Infinity,
    aimErrorDeg: 0,
    targetSwitchMs: 0,
    velocityErr: 0,
    entryIdleMs: 0,
    recoverMs: 0,
    castReactionMs: 0,
    castGapMs: 0,
    dashDelayMs: 0,
    dashSkipChance: 0,
    spacingSlopPx: 0,
    timidityPx: 0,
    bodyFearPx: 0,
    swingReactionMs: 0,
  },
  /**
   * **The person who makes this game**, fitted to a real logged run.
   *
   * The one profile in this file that is not a guess about a kind of player.
   * It is `playtest-4.json` — sixteen rooms, won, 104 HP lost over the run, 98%
   * of it ranged, nothing at all lost in rooms 1 to 3 — turned into parameters
   * with `pnpm play:calibrate`, and it is the profile the difficulty targets
   * are now written against, because it is the only one measured against a
   * person playing the build that shipped.
   *
   * It sits between `average` and `expert` and nearer `expert`: the room times
   * are an `average` player's, the damage taken is much closer to an
   * `expert`'s. That is what a designer who knows every telegraph but is
   * playing with a keyboard and one pair of eyes looks like — the mistakes are
   * rare, and they are almost all "shot from somewhere while busy with
   * something else", which is what `blindSpotMs` and the attention budgets
   * below are.
   *
   * Refit it the same way if the log is replaced: `JR_SKILL=<param>=<value>,…`
   * against `pnpm play:calibrate <log> 6`, then write the numbers in here.
   */
  player: {
    name: "player",
    reactionMs: 240,
    /*
     * Where nearly all of the damage comes from. The log's melee share is 2%
     * and its hazard share is nil: this person is not walked down by a rusher
     * and does not stand in spikes. What gets them is a shooter they were not
     * looking at, so the blind spot is the one clock kept well above expert's.
     */
    blindSpotMs: 260,
    decisionMs: 55,
    attentionBullets: 7,
    attentionEnemies: 7,
    aimErrorDeg: 5,
    targetSwitchMs: 320,
    velocityErr: 0.1,
    entryIdleMs: 500,
    recoverMs: 60,
    castReactionMs: 150,
    castGapMs: 700,
    dashDelayMs: 110,
    dashSkipChance: 0.2,
    spacingSlopPx: 7,
    timidityPx: 4,
    /*
     * Nearly nil. The log's first three rooms cost nothing at all and they are
     * full of rushers: this player walks into the crowd and swings, which is
     * why their damage is ranged rather than melee.
     */
    bodyFearPx: 10,
    swingReactionMs: 70,
  },
  /**
   * Somebody who has played the game for a few hours and knows the telegraphs.
   *
   * **Provisional.** It was fitted against logs recorded while the browser ran
   * every room as room 99 — full waves, ×1.7 body health, none of the early
   * softening — so the player it describes is one who was handed the late run
   * from the first door, and it came out too weak. `player` above is the one
   * fitted to the fixed build; treat this and `novice` as rough reference
   * points until they are refitted against logs from it.
   */
  average: {
    name: "average",
    reactionMs: 250,
    blindSpotMs: 220,
    decisionMs: 60,
    attentionBullets: 8,
    attentionEnemies: 8,
    aimErrorDeg: 7,
    targetSwitchMs: 400,
    velocityErr: 0.12,
    entryIdleMs: 700,
    recoverMs: 90,
    castReactionMs: 250,
    castGapMs: 1200,
    dashDelayMs: 150,
    dashSkipChance: 0.3,
    spacingSlopPx: 10,
    timidityPx: 8,
    bodyFearPx: 40,
    swingReactionMs: 120,
  },
  /**
   * Somebody in their first run, who has not learned any of the telegraphs.
   *
   * **Provisional, for the same reason `average` is**: fitted to a session
   * recorded while every browser room ran as room 99. Reference only.
   */
  novice: {
    name: "novice",
    /*
     * **Not above 280 ms**, whatever "a beginner is slow" suggests.
     *
     * The rusher's thrust winds up for 280 ms and lunges for 190, and the design
     * documents size every telegraph against a 250 ms floor. At the 320 ms this
     * was first fitted to, the entire windup happened before the model could see
     * it: measured, it had not perceived the attack on 43% of the rusher hits it
     * took, and melee was half of all its damage. That is not a novice, it is a
     * player the game was never designed for, and it turns every melee telegraph
     * into an unavoidable hit. A beginner is slow to *understand* a telegraph,
     * which the decision rate and the attention budget below model; they are not
     * slower than the telegraph itself.
     */
    reactionMs: 270,
    blindSpotMs: 520,
    decisionMs: 120,
    attentionBullets: 2,
    attentionEnemies: 4,
    aimErrorDeg: 16,
    targetSwitchMs: 1100,
    velocityErr: 0.3,
    entryIdleMs: 3500,
    recoverMs: 200,
    castReactionMs: 650,
    castGapMs: 8000,
    dashDelayMs: 500,
    dashSkipChance: 0.8,
    /*
     * Forty px of slop on a fifteen px band: the swings mostly miss, which is
     * where the room's length comes from now. It replaced most of `timidityPx`,
     * because hovering out of reach and whiffing in reach both make a fight
     * long, and only the second leaves the model able to defend itself.
     */
    spacingSlopPx: 40,
    timidityPx: 10,
    bodyFearPx: 260,
    swingReactionMs: 150,
  },
};

export function skillProfile(name: string | undefined): SkillProfile {
  const p = name ? SKILL_PROFILES[name as SkillName] : SKILL_PROFILES.expert;
  if (!p) throw new Error(`unknown skill profile "${name}"; expected one of ${SKILL_NAMES.join(", ")}`);
  return withOverrides(p);
}

/**
 * `JR_SKILL=timidityPx=60,castGapMs=2400` overrides individual parameters.
 *
 * Fitting a profile to a real log means trying a dozen values of one number
 * against the same seeds, and editing the preset between each is how a fit
 * gets lost. The presets are what the harness reports; this is the bench they
 * were fitted on, and it fails loudly on a name that is not a parameter rather
 * than silently measuring the preset.
 */
function withOverrides(p: SkillProfile): SkillProfile {
  const spec = process.env.JR_SKILL;
  if (!spec) return p;
  const out: Record<string, unknown> = { ...p };
  for (const pair of spec.split(",")) {
    const [key, value] = pair.split("=");
    if (!key || value === undefined) throw new Error(`JR_SKILL: expected key=value, got "${pair}"`);
    if (!(key in p) || key === "name") throw new Error(`JR_SKILL: "${key}" is not a skill parameter`);
    out[key] = Number(value);
  }
  return out as unknown as SkillProfile;
}

/**
 * Deterministic pseudo-randomness, hashed from whatever the caller passes.
 *
 * Every "human" roll in the model goes through this rather than `Math.random`,
 * because the harness's whole value is that a seed replays. Callers pass the
 * world clock plus a salt naming what is being decided, so two different
 * decisions on the same frame do not share a value.
 */
export function noise(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** The same, centred on zero: −1 to 1. */
export function signedNoise(a: number, b: number): number {
  return noise(a, b) * 2 - 1;
}

/** A stable small integer for a string salt, so salts can be written as words. */
export function salt(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
  return h >>> 0;
}
