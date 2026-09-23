/**
 * The hand-tuned control (design doc 011). This is the baseline the project
 * has to beat: the same information, the same pipeline, a weight table where
 * Jev's distribution would be. Editing it changes the control, so it changes
 * the experiment.
 */
import { SPELL_SCHOOLS, STYLE_SCHOOLS } from "@jr/core";
import type { WeightTable } from "./source.ts";

function label(state: Readonly<Record<string, unknown>>, path: string): string {
  let cur: unknown = state;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : "";
}

const hurt = (s: Readonly<Record<string, unknown>>) =>
  ["low", "critical"].includes(label(s, "health")) || label(s, "recent_damage") === "heavy";

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

export const ruleTable: WeightTable = (scopedQuestion, option, scopedState) => {
  const [question, state] = unscope(scopedQuestion, scopedState);
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

    case "next_tension":
      if (option === "release") return hurt(state) ? 4 : 1;
      if (option === "build") return 1.5;
      return label(state, "clear_speed") === "fast" && !hurt(state) ? 2.5 : 0.8;

    case "space": {
      // Long range wants cover to break line of sight; short range wants room.
      const range = label(state, "build_range");
      const covered = option.includes("corridor") || option.includes("ring") || option.includes("gallery");
      const open = option.includes("open") || option.includes("scattered");
      if (range === "long") return covered ? 2 : open ? 0.7 : 1;
      if (range === "short") return open ? 1.8 : covered ? 0.7 : 1;
      return 1;
    }

    case "symmetry":
      return option === "mirrored" ? (label(state, "tension") === "peak" ? 2 : 1) : 1;

    case "mood_temperature":
      return option === "warm" ? (hurt(state) ? 2 : 1) : label(state, "tension") === "peak" ? 2 : 1;
    case "mood_brightness":
      return option === "bright" ? (hurt(state) ? 2 : 1) : 1;
    case "mood_particles":
      return option === "busy" ? (label(state, "tension") === "peak" ? 1.6 : 0.8) : 1;

    case "composition": {
      const range = label(state, "build_range");
      if (hurt(state)) return option === "mixed" ? 1.5 : 1;
      if (range === "long") return option === "melee_heavy" ? 2 : 1;
      if (range === "short") return option === "ranged_heavy" ? 2 : 1;
      return 1;
    }
    case "density":
      if (option === "dense") return label(state, "tension") === "peak" ? 2.2 : 0.5;
      if (option === "sparse") return hurt(state) ? 2.5 : 0.8;
      return 1.4;
    case "wave_structure":
      // Staging is the room-length lever (doc 014): a single wave is over in
      // one time-to-kill, however many bodies the band admits. An elite room
      // leans hardest on it: its band is reached by a heavy trickle as well as
      // by a packed single wave, and the trickle is the longer fight rather
      // than the spikier one — the packed wave was what took six hearts.
      if (label(state, "room_type") === "elite") return option === "trickle" ? 2.0 : option === "two_waves" ? 1.2 : 0.6;
      if (option === "trickle") return label(state, "tension") === "release" ? 2 : 1.6;
      if (option === "single") return label(state, "tension") === "peak" ? 1.4 : 0.6;
      return 1.3;
    case "anchor":
      if (option === "none") return 1.5;
      return label(state, "clear_speed") === "fast" ? 1.5 : 0.8;
    case "entry":
      if (option === "surround") return label(state, "health") === "full" ? 1.4 : 0.2;
      return 1;

    case "variety": {
      const consistency = label(state, "consistency");
      if (option === "high") return consistency === "pivoted" ? 3 : 0.6;
      if (option === "low") return consistency === "on_plan" ? 2 : 0.6;
      return 1.5;
    }
    case "affix_intent": {
      const bottleneck = label(state, "bottleneck");
      if (option === "homing") return bottleneck === "accuracy" ? 3 : 0.2;
      if (option === "cheaper") return label(state, "mana_sustain") === "tight" ? 3 : 0.5;
      if (option === "elemental") return label(state, "archetype") === "dot" ? 2.5 : 0.8;
      if (option === "heavier") return label(state, "archetype") === "nuke" ? 2 : 1;
      if (option === "wider") return label(state, "archetype") === "spam" ? 2 : 1;
      return 1;
    }

    /*
     * The portal question (doc 003). These reproduce what `ruleDoors` drew,
     * with the run's state leaning on it: the control has to be the same
     * game as the rules it replaced, plus the labels.
     */
    case "portal_kinds": {
      const progress = label(state, "run_progress");
      const kindWeight = (k: string): number => {
        if (k === "gold") return label(state, "gold") === "poor" ? 1.3 : label(state, "gold") === "rich" ? 0.7 : 1;
        if (k === "stat") return hurt(state) ? 1.5 : 1;
        if (k === "spell") return progress === "early" ? 1.3 : progress === "late" || progress === "pre_boss" ? 0.8 : 1;
        if (k === "affix") return progress === "early" ? 0.8 : 1.2;
        return 1;
      };
      return option.split("+").reduce((w, k) => w * kindWeight(k), 1);
    }
    case "elite_portal": {
      if (option === "none") return 1;
      // `ruleDoors` put an elite on every multi-door offer it could, and a
      // lone door about a third of the time.
      const base = label(state, "portal_count") === "1" ? 0.43 : 2.4;
      return base * (label(state, "health") === "full" ? 1.3 : hurt(state) ? 0.25 : 1);
    }
    case "elite_kind":
      return option === "gold" ? 0.7 : 1;
    case "elite_grade":
      return option === "3" ? 0.35 : 0.65;
    case "normal_grade":
      return option === "2" ? 0.25 : 0.75;
    case "spell_school": {
      // Half the mass on the schools that hold the chosen style, half even.
      const leaning = STYLE_SCHOOLS[label(state, "intent.preset")] ?? [];
      const even = 0.5 / SPELL_SCHOOLS.length;
      return leaning.includes(option as never) ? even + 0.5 / leaning.length : leaning.length ? even : 1;
    }
    case "stat_family":
      if (option === "survival") return hurt(state) ? 2.2 : 1;
      if (option === "mana") return label(state, "mana_sustain") === "tight" ? 1.8 : 1;
      if (option === "sword") return label(state, "intent.preset") === "melee" ? 1.8 : 1;
      return 1;
    case "npc_room": {
      // Rare: about one room in eight offers a vendor, more with gold to spend.
      if (option === "none") return 14;
      const gold = label(state, "gold");
      const g = gold === "rich" ? 2.2 : gold === "poor" ? 0.3 : 1;
      return option === "merchant" ? g : g * 0.8;
    }

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
      if (question === "for_needs") return (has("need") ? 3 : 1) * (has("bottleneck") ? 2 : 1) * (has("upgrade") ? 1.3 : 1);
      if (question === "temptation") return has("need") ? 1.5 : 1;
      return (has("style") ? 1.4 : 1) * (has("build") ? 1.4 : 1) * (has("need") ? 2 : 1)
        * (has("bottleneck") ? 1.5 : 1) * (has("synergy") ? 1.3 : 1) * (has("upgrade") ? 1.4 : 1);
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
