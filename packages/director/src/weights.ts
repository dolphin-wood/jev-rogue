/**
 * The hand-tuned control (design doc 011). This is the baseline the project
 * has to beat: the same information, the same pipeline, a weight table where
 * Jev's distribution would be. Editing it changes the control, so it changes
 * the experiment.
 */
import type { WeightTable } from "./source.ts";
import { FREE_TEXT_WEIGHT, laneFromText } from "./questions/affixes.ts";
import { NOUL_YES } from "./types.ts";

function label(state: Readonly<Record<string, unknown>>, path: string): string {
  let cur: unknown = state;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : "";
}

/** The player's typed intent, as the state carries it (doc 002 caps it at 120 characters). */
const freeText = (s: Readonly<Record<string, unknown>>): string | undefined => {
  const v = label(s, "intent.free_text");
  return v || undefined;
};

const hurt = (s: Readonly<Record<string, unknown>>) =>
  ["low", "critical"].includes(label(s, "health")) || label(s, "recent_damage") === "heavy";

/**
 * The player is doing well enough to be pressed: the same test `next_tension`
 * makes when it leans to `peak`. Round 1 decides the tension and the room in
 * one request, so the room's questions cannot read the tension — they read
 * what the tension reads.
 */
const pressing = (s: Readonly<Record<string, unknown>>) =>
  label(s, "clear_speed") === "fast" && !hurt(s);

/**
 * The build's standing against the curve, as a multiplier on "press harder".
 *
 * Deliberately gentler than the state signals it sits beside. It must not
 * compound with `clear_speed` into a runaway — a strong build that also clears
 * fast would otherwise be pushed to the top of every axis at once — and the
 * ramp is the hard bound underneath in any case.
 */
const power = (s: Readonly<Record<string, unknown>>): number => {
  const p = label(s, "damage_rate");
  return p === "high" ? 1.4 : p === "low" ? 0.7 : 1;
};

/**
 * A question scoped by a prefix (`shop_stat__overall`, see `OfferRequest`)
 * is weighed as the unscoped question over its own scoped state keys.
 */
function unscope(question: string, state: Readonly<Record<string, unknown>>): [string, Readonly<Record<string, unknown>>] {
  const at = question.indexOf("__");
  if (at < 0) return [question, state];
  const prefix = question.slice(0, at + 2);
  const scoped = Object.fromEntries(Object.entries(state).flatMap(([k, v]) =>
    k.startsWith(prefix) ? [[k.slice(prefix.length), v]] : []));
  return [question.slice(at + 2), { ...state, ...scoped }];
}

/**
 * The rule table's weight for one card on the `overall` axis, from the facts
 * code attached to it; see the card questions below.
 */
function cardWeight(state: Readonly<Record<string, unknown>>, id: string): number {
  const facts = label(state, `card_facts.${id}`);
  if (!facts) return 1;
  const has = (f: string) => facts.split(" ").includes(f);
  return (has("style") ? 1.4 : 1) * (has("build") ? 1.4 : 1) * (has("need") ? 2 : 1)
    * (has("eases") ? 1.5 : 1) * (has("synergy") ? 1.3 : 1) * (has("upgrade") ? 1.4 : 1);
}

/**
 * What a per-card Noul's `no` weighs against the card's weight as its `yes`:
 * a plain card reads 0.25, one carrying every fact about 0.9. It only answers
 * when Jev failed or was not asked, and it keeps the same order the `overall`
 * axis gives.
 */
const FIT_NO_WEIGHT = 3;

export const ruleTable: WeightTable = (scopedQuestion, option, scopedState) => {
  const [question, state] = unscope(scopedQuestion, scopedState);
  if (question.startsWith("fit_"))
    return option === NOUL_YES ? cardWeight(state, question.slice("fit_".length)) : FIT_NO_WEIGHT;
  switch (question) {
    case "door_set": {
      let w = 1;
      const types = option.split("+");
      w *= Math.pow(1.15, types.length - 1);
      if (types.includes("rest")) w *= hurt(state) ? 3 : 0.5;
      if (types.includes("shop")) w *= label(state, "gold") === "rich" ? 2 : label(state, "gold") === "poor" ? 0.6 : 1;
      if (types.includes("elite")) w *= label(state, "health") === "full" ? 1.8 : hurt(state) ? 0.3 : 1;
      return w;
    }

    /*
     * The arc, not just the moment. The control reads the same recent-history
     * labels the question gives Jev: a run that has been hard for a while owes
     * a release, and one that has just let up can climb. (A peak after a peak
     * is not weighed down here — it is not offered at all; see `tensionsAfter`.)
     */
    case "next_tension": {
      const since = label(state, "since_release");
      const last = label(state, "last_tension");
      if (option === "release") {
        let w = hurt(state) ? 4 : 1;
        if (since === "long") w *= 3;
        else if (since === "a_while") w *= 1.6;
        if (last === "peak") w *= 2;
        return w;
      }
      if (option === "build") return since === "long" ? 1.2 : 1.5;
      let w = (label(state, "clear_speed") === "fast" && !hurt(state) ? 2.5 : 0.8) * power(state);
      // A run that has not let up in a while should not be climbing.
      if (since === "long") w *= 0.35;
      if (label(state, "last_room_kind") === "rest") w *= 1.5;
      return w;
    }

    case "space": {
      // Long range wants cover to break line of sight; short range wants room.
      // Read off what the player actually did: a run whose damage is mostly
      // the blade wants room to close, one that is mostly spells wants cover.
      const sword = label(state, "sword_share");
      const covered = option.includes("corridor") || option.includes("ring") || option.includes("gallery");
      const open = option.includes("open") || option.includes("scattered");
      if (sword === "none") return covered ? 2 : open ? 0.7 : 1;
      if (sword === "most") return open ? 1.8 : covered ? 0.7 : 1;
      return 1;
    }

    /*
     * **Round 1 has no tension to read.** It is decided in the same request
     * (doc 004), so these weigh the labels `next_tension` itself weighs, and
     * the room comes out the size and the colour the player's situation asks
     * for rather than the size the tension asks for. `pressing` is the same
     * test `next_tension` applies, written once.
     */
    /*
     * **The look questions alternate here too.** Measured on the live model
     * these four were 91% to 100% one answer each, because all four read the
     * same three health labels; the control had the same shape and the same
     * fault. Each now weighs the last room's answer, which is the same fact
     * the Jev arm's options are grounded on, so the two arms still differ in
     * exactly one thing.
     */
    case "symmetry": {
      const again = label(state, "last_symmetry") === option ? 0.4 : 1.6;
      return again * (option === "mirrored" ? (hurt(state) ? 2 : 1) : pressing(state) ? 1.4 : 1);
    }

    case "size": {
      // A hurt player gets a short walk to a small fight; one who is coping
      // can take the whole floor (doc 017). Rooms without a fight are small.
      const type = label(state, "room_type");
      if (type !== "combat" && type !== "elite") return option === "compact" ? 4 : 0.3;
      if (type === "elite" || pressing(state)) return option === "vast" ? 2 : option === "standard" ? 1.2 : 0.4;
      if (hurt(state)) return option === "compact" ? 2 : option === "standard" ? 1 : 0.3;
      return option === "standard" ? 2 : 0.8;
    }

    case "mood_temperature": {
      const again = label(state, "last_mood_temperature") === option ? 0.35 : 1.6;
      const late = ["late", "pre_boss"].includes(label(state, "run_progress"));
      return again * (option === "cold" ? (late ? 1.6 : 0.9) : late ? 0.9 : 1.3);
    }
    case "mood_brightness": {
      const again = label(state, "last_mood_brightness") === option ? 0.35 : 1.6;
      // `hazard_cap` is `high` whenever the player is above two hearts, so it
      // decided this question by itself; the damage trend actually moves.
      return again * (option === "bright" ? (label(state, "damage_trend") === "rising" ? 1.6 : 0.9) : 1.2);
    }
    case "mood_particles": {
      const again = label(state, "last_mood_particles") === option ? 0.35 : 1.6;
      return again * (option === "busy"
        ? (label(state, "movement_pressure_recent") === "heavy" || hurt(state) ? 0.5 : 1.4)
        : 1.1);
    }

    case "composition": {
      const sword = label(state, "sword_share");
      if (hurt(state)) return option === "mixed" ? 1.5 : 1;
      if (sword === "none") return option === "melee_heavy" ? 2 : 1;
      if (sword === "most") return option === "ranged_heavy" ? 2 : 1;
      return 1;
    }
    case "density": {
      const since = label(state, "since_release");
      if (option === "dense") return (label(state, "tension") === "peak" ? 2.2 : 0.5) * (since === "long" ? 0.5 : 1) * power(state);
      if (option === "sparse") return (hurt(state) ? 2.5 : 0.8) * (since === "long" ? 1.8 : 1) / power(state);
      return 1.4;
    }
    case "wave_structure":
      // Staging is the room-length lever (doc 014): a single wave is over in
      // one time-to-kill, however many bodies the band admits. An elite room
      // leans hardest on it: its band is reached by a heavy trickle as well as
      // by a packed single wave, and the trickle is the longer fight rather
      // than the spikier one — the packed wave was what took six hearts.
      // An elite room cannot breathe, so the choice there is how hard it
      // presses: steady by default, relentless when the player can take it.
      if (label(state, "room_type") === "elite") return option === "relentless" ? (hurt(state) ? 0.5 : 1.4) : 1.4;
      if (option === "breathe")
        return (label(state, "tension") === "release" ? 2 : 1.2) * (hurt(state) ? 2 : 1)
          * (label(state, "last_tension") === "peak" ? 1.4 : 1);
      if (option === "relentless")
        return (label(state, "tension") === "peak" ? 1.6 : 0.6) * power(state) * (hurt(state) ? 0.3 : 1);
      return 1.4;
    case "anchor":
      if (option === "none") return 1.5 / power(state);
      return (label(state, "clear_speed") === "fast" ? 1.5 : 0.8) * power(state);
    /*
     * **Doc 019's tier, for the rule arm.** The Jev arm reads the grounded
     * option text; this is the same judgement as weights, so a rule run and a
     * degraded Jev run stay the control the experiment needs (002).
     */
    case "subspecies_weight": {
      const progress = label(state, "run_progress");
      const early = progress === "early";
      if (option === "none") return (early ? 3 : 0.6) * (hurt(state) ? 2 : 1) / power(state);
      if (option === "many") return (early ? 0.15 : 1.4) * power(state) * (hurt(state) ? 0.4 : 1);
      return 1.6;
    }
    /*
     * One ranked question now, not two slot questions. Which variant is
     * flavour, so the control spreads evenly over them; `none` carries the
     * intent the old pair carried between them — a room usually holds one
     * kind, sometimes two, and early on often none.
     */
    case "subspecies":
      return option === "none" ? (label(state, "run_progress") === "early" ? 3 : 1.2) : 1;
    case "elite_presence": {
      if (option === "none") return (hurt(state) ? 3 : 1) * (label(state, "damage_trend") === "rising" ? 1.8 : 1) / power(state);
      if (option === "two") return label(state, "health") === "full" && !hurt(state) ? 1.2 * power(state) : 0.15;
      return 1.3 * power(state);
    }
    case "entry":
      if (option === "surround") return label(state, "health") === "full" ? 1.4 : 0.2;
      return 1;

    case "variety": {
      const off = label(state, "off_style_picks");
      if (option === "high") return off === "two_running" ? 3 : 0.6;
      if (option === "low") return off === "none" ? 2 : 0.6;
      return 1.5;
    }
    /*
     * Doc 007's affix lane. The control reads the same three things the
     * question gives Jev — the stated style, the player's own words, and what
     * the last rooms measured — because a control that
     * ignored the free text would be a straw man on the one question where the
     * player said in words what they wanted (doc 011).
     */
    case "affix_intent": {
      // The same facts the question gives Jev, and no verdicts: what the last
      // rooms measured, which way the keys lean, and what the player typed.
      const hits = label(state, "hits_per_shot");
      const casts = label(state, "cast_rate");
      const damage = label(state, "damage_rate");
      const lean = label(state, "keys_lean");
      const preset = label(state, "intent.preset");
      let w = 1;
      if (option === "homing") w = hits === "few" ? 3 : 0.5;
      // Casts that go off without a press: a slow cast rate, or a build that lives on the sword.
      else if (option === "freecast") w = casts === "slow" ? 2 : label(state, "sword_share") === "most" ? 1.6 : 0.5;
      else if (option === "elemental") w = lean === "dot" || lean === "area" ? 2.5
        : preset === "dot" || preset === "area" ? 1.8 : 0.8;
      else if (option === "heavier") w = lean === "nuke" ? 2
        : preset === "nuke" ? 1.6 : damage === "low" ? 1.4 : 1;
      else if (option === "wider") w = lean === "spam" || lean === "area" ? 2
        : preset === "spam" || preset === "area" ? 1.6 : 1;
      else if (option === "survival") w = hurt(state) ? 2.5
        : label(state, "hurt_by") === "blades" ? 2 : preset === "melee" ? 2 : 0.6;
      // The player's own words outrank every label above: they are the one
      // input that is not inferred. Read off `typed_intent`, the label the
      // state carries, so both arms weigh the same reading of the sentence.
      if (label(state, "typed_intent") === option) w *= FREE_TEXT_WEIGHT;
      return w;
    }

    /*
     * The portal question (doc 003). These reproduce what `ruleDoors` drew,
     * with the run's state leaning on it: the control has to be the same
     * game as the rules it replaced, plus the labels.
     */
    /*
     * Doc 007's rule: **the less complete the build, the more the offer should
     * be the things that let it take shape.** The control reads the same
     * completion signal the question gives Jev, so a rule run and a degraded
     * Jev run stay the control the experiment needs (doc 011).
     */
    /*
     * **One weight per reward, not per combination.** The control ranks the
     * same single options the Jev arm ranks, and code turns the ranking into
     * doors, so the two arms still differ in exactly one thing.
     */
    case "portal_need": {
      const shape = label(state, "build_shape");
      const gold = label(state, "gold");
      /*
       * **The run's own history, weighed** — the same three facts the Jev
       * arm's options are grounded on (`KIND_CLAUSE`). Without them the
       * control has the fault the whole change is about: once affix slots
       * open, `forming` holds for most of a run and the affix door wins every
       * offer, so the player stops choosing. A badge shown three rooms running
       * is damped, and one the player keeps walking past is damped further;
       * neither is removed, because a player who genuinely still needs affixes
       * should still get them.
       */
      const fatigue = (label(state, "door_offered_running") === option ? 0.35 : 1)
        * (label(state, "door_skipped_most") === option ? 0.5 : 1);
      // What the staff still has room for. An affix door to a staff with no
      // slot left, or a stat door to a build whose bar buys plenty, pays little.
      const slots = label(state, "affix_slots_open");
      const levels = label(state, "spell_levels");
      const casts = label(state, "casts_per_bar");
      if (option === "affix")
        return fatigue * (slots === "none" ? 0.3 : slots === "few" ? 0.9 : 1)
          * (shape === "forming" ? 2 : shape === "raw" ? 0.7 : 1.2);
      if (option === "spell")
        return fatigue * (shape === "raw" ? 2.2 : shape === "forming" ? 1 : 0.7)
          // A full staff with nothing raised: the spell door is the level door.
          * (levels === "all_base" ? 1.8 : levels === "some_raised" ? 1.2 : 0.8);
      if (option === "stat")
        return fatigue * (hurt(state) ? 1.5 : 1) * (shape === "formed" ? 1.5 : 0.8)
          // The only door that makes the bar bigger, and levels keep shrinking it.
          * (casts === "few" && label(state, "mana_stats_taken") === "none" ? 2.2
            : casts === "few" ? 1.4 : 1);
      // Gold is the one reward the player cannot use in the room they win it
      // in, so it is worth a portal only where there is a shortage and a
      // vendor still to come. Played, it was the door nobody wanted.
      if (option === "gold") return fatigue * (gold === "poor" ? 1.2 : gold === "rich" ? 0.4 : 0.7)
        * (shape === "formed" ? 1.4 : 0.8);
      /*
       * The rooms with no fight. They rank against the rewards rather than
       * against an escape option, so their weights are on the same scale: a
       * vendor takes a door only when it beats a reward the player could have
       * had instead. `NPC_OFFERS_MAX` is the cap underneath.
       */
      /*
       * Deliberately **below** a reward that the build actually needs. At 1.6
       * the merchant outranked a spell door for a raw build and took a door in
       * 99% of offers, which is the nagging `NPC_OFFERS_MAX` exists to bound
       * and a rate no cap should have to rescue. It wins where the rewards are
       * weak — a formed build, money in hand — and loses to a key that is
       * still empty.
       */
      if (option === "merchant") return (gold === "rich" ? 1.35 : gold === "poor" ? 0.15 : 0.8)
        * (shape === "formed" ? 0.5 : 1.2);
      if (option === "smith") return gold === "rich" ? 0.5 : 0.15;
      if (option === "fountain") {
        const health = label(state, "health");
        const base = health === "critical" ? 6 : health === "low" ? 2.6 : health === "ok" ? 0.5 : 0.05;
        return base * (label(state, "recent_damage") === "heavy" ? 1.6 : 1);
      }
      return 1;
    }
    case "elite_portal": {
      if (option === "none") return 1;
      // `ruleDoors` put an elite on every multi-door offer it could, and a
      // lone door about a third of the time.
      const base = label(state, "portal_count") === "one" ? 0.43 : 2.4;
      return base * (label(state, "health") === "full" ? 1.3 : hurt(state) ? 0.25 : 1) * power(state);
    }
    // The grade reads as a word rather than the digit it applies: whether the
    // room's per-door draws lean up (`rollNormalGrades`), a quarter of the time.
    case "normal_grade":
      return option === "raised" ? 0.25 : 0.75;
    /*
     * Doc 007's three axes over one kind's legal cards, read off the facts
     * code attached to each card. The same shape as the doc's control table:
     * a need doubles, the style is ×1.6.
     */
    /*
     * Doc 007's axes over one kind's legal cards, read off the facts code
     * attached to each (task 9). Every legal card stays in the pool; a fact
     * multiplies its weight. **Style** is two facts, the stated and the
     * revealed, so a player who drifts from what they asked for is followed;
     * **needs** are what the run is short of and what limits the build; an
     * **upgrade** or a **synergy** is how a build matures rather than widens.
     */
    case "overall":
    case "for_style":
    case "for_needs":
    case "temptation": {
      const facts = label(state, `card_facts.${option}`);
      if (!facts) return 1;
      const has = (f: string) => facts.split(" ").includes(f);
      if (question === "for_style") return (has("style") ? 2.4 : 1) * (has("build") ? 2 : 1) * (has("synergy") ? 1.4 : 1);
      if (question === "for_needs") return (has("need") ? 3 : 1) * (has("eases") ? 2 : 1) * (has("upgrade") ? 1.3 : 1);
      if (question === "temptation") return has("need") ? 1.5 : 1;
      return cardWeight(state, option);
    }

    case "reward_kind":
      if (option === "heal") return hurt(state) ? 3 : 0.1;
      if (option === "gold") return label(state, "gold") === "poor" ? 1.5 : 0.7;
      if (option === "staff_upgrade") return 0.8;
      return 2;

    default:
      // Zone questions and anything else fall through to an even hand.
      if (question.startsWith("zone_")) return option === "none" ? 2 : 1;
      return 1;
  }
};
