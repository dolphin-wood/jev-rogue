/**
 * The two ways a translation rots, caught at build time.
 *
 * A missing key is invisible in the language nobody on the team reads: the
 * fallback quietly serves English and the screen looks fine to whoever is
 * checking it. These tests are the only thing that notices.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  affixFitsPart, affixTextKey, ALL_ENEMY_IDS, ALL_TAGS, ARCHETYPES, BOSS_ARCHETYPES,
  affixStatParts, ELITE_AFFIX_IDS, emptyHistory, FEATURES, gradeTagPart, ITEMS, LABELS, offerStatParts,
  PLAYABLE_ARCHETYPES, portalChoices, REWARD_KINDS, RngSource, runStaff, SPELL_AFFIXES,
  SPELL_SCHOOLS, statLinePart, STAT_FAMILIES, STAT_UPGRADES,
} from "@jr/core";
import type {
  Anchor, CardFact, Composition, Density, EntryPattern, Mood, RewardCardKind, RoomSize, RoomType,
  RunContext, Symmetry, WaveStructure,
} from "@jr/core";
import { createDirector } from "@jr/director";
import type {
  AffixIntent, CardOrigin, ChoiceAnswer, Evaluator, FallbackPath, ObservedRequest,
} from "@jr/director";
import { questionName } from "../ui/question-names.ts";
import { CATEGORIES, CATEGORY_OF } from "../director-readout.ts";
import { EN } from "./en.ts";
import { ZH } from "./zh.ts";
import { JA } from "./ja.ts";
import {
  bodyPx, contentTable, fontPx, LANGS, letterSpacing, localizeStat, MIN_BODY_PX, MIN_RENDERED_PX, setLang,
  stringTable, t, term, wrapText,
} from "./index.ts";

describe("string tables", () => {
  const keys = Object.keys(EN);

  it("has the same keys in every language", () => {
    for (const lang of LANGS) {
      const table = stringTable(lang) as Record<string, string>;
      const missing = keys.filter((k) => !table[k]);
      expect(missing, `${lang} is missing keys`).toEqual([]);
      const extra = Object.keys(table).filter((k) => !(k in EN));
      expect(extra, `${lang} has keys English does not`).toEqual([]);
    }
  });

  it("carries every placeholder through each translation", () => {
    const placeholders = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((n) => n !== "coin").sort();
    for (const key of keys) {
      const want = placeholders(EN[key as keyof typeof EN]);
      for (const [name, table] of [["zh", ZH], ["ja", JA]] as const) {
        expect(placeholders(table[key as keyof typeof EN]), `${name} ${key}`).toEqual(want);
      }
    }
  });

  it("keeps the keycap markup a keycap", () => {
    // `[E]` and friends are drawn as chips; a translation that loses the
    // brackets loses the chip and prints a bare letter mid-sentence.
    for (const key of keys) {
      // `[@action]` too: the cap that reads whatever key the action is on.
      const caps = (s: string) => [...s.matchAll(/\[(@?\w+)\]/g)].map((m) => m[1]!).sort();
      const want = caps(EN[key as keyof typeof EN]);
      for (const [name, table] of [["zh", ZH], ["ja", JA]] as const) {
        expect(caps(table[key as keyof typeof EN]), `${name} ${key}`).toEqual(want);
      }
    }
  });
});

describe("content tables", () => {
  /** Every id the player can be shown a name for. */
  const ids = [
    ...[...ITEMS.keys()],
    ...SPELL_AFFIXES.map((a) => a.id),
    ...STAT_UPGRADES.map((s) => s.id),
    ...SPELL_SCHOOLS,
    ...["spam", "nuke", "area", "dot", "melee"].map((s) => `style.${s}`),
  ];

  it("names every content id in Chinese and Japanese", () => {
    for (const lang of ["zh", "ja"] as const) {
      const table = contentTable(lang);
      const missing = ids.filter((id) => !table[id]?.name);
      expect(missing, `${lang} is missing names`).toEqual([]);
    }
  });

  it("describes every spell in Chinese and Japanese", () => {
    // Only the items get descriptions: an affix's text is its tier line, and
    // a school is a single word.
    for (const lang of ["zh", "ja"] as const) {
      const table = contentTable(lang);
      const missing = [...ITEMS.keys()].filter((id) => !table[id]?.description);
      expect(missing, `${lang} is missing descriptions`).toEqual([]);
    }
  });
});

/*
 * Core writes every number line and rules sentence in English, because the
 * harness, the tests and the Director read that text. Each one also carries
 * a `key`, and the renderer says it through this table — so a key core can
 * produce and the table has never heard of is a line that silently stays
 * English on a Chinese screen. The only way to catch that is to ask core
 * for every line it can produce.
 */
const produced = (): { key: string; args?: Readonly<Record<string, string | number>> }[] => {
  const out: { key: string; args?: Readonly<Record<string, string | number>> }[] = [];
  const take = (p: { key?: string; args?: Readonly<Record<string, string | number>> }) => {
    if (p.key) out.push({ key: p.key, args: p.args });
  };
  // Every spell and rune, at every level a card can show one at.
  for (const item of ITEMS.values())
    for (const level of [1, 2, 3, 4, 5]) offerStatParts(item, level).forEach(take);
  // Every stat upgrade, singly and doubled (an elite door applies it twice).
  for (const up of STAT_UPGRADES) for (const times of [1, 2]) take(statLinePart(up, times));
  // Every affix: where it goes, what each of its tiers says, and — for the
  // ones that multiply how often a press lands — what that adds to the bill.
  for (const a of SPELL_AFFIXES) {
    take(affixFitsPart(a));
    out.push({ key: affixTextKey(a.id) });
    affixStatParts(a).forEach(take);
  }
  // A graded card's tag.
  for (const kind of ["spell", "affix", "stat", "gold"] as RewardCardKind[])
    for (const grade of [1, 2, 3]) {
      const tag = gradeTagPart(kind, grade);
      if (tag) take(tag);
    }
  return out;
};

const keysOf = (r: Readonly<Record<string, unknown>>) => Object.keys(r);

/** Unions with no runtime list of their own; the Record makes them exhaustive. */
const SYMMETRIES: Record<Symmetry, true> = { mirrored: true, asymmetric: true };
const SIZES: Record<RoomSize, true> = { compact: true, standard: true, vast: true };
const MOODS: Record<Mood["temperature"] | Mood["brightness"] | Mood["particle_intensity"], true> =
  { cold: true, warm: true, dim: true, bright: true, calm: true, busy: true };
const COMPS: Record<Composition, true> =
  { melee_heavy: true, ranged_heavy: true, mixed: true, siege: true };
const DENSITIES: Record<Density, true> = { sparse: true, normal: true, dense: true };
const WAVES: Record<WaveStructure, true> = { relentless: true, steady: true, breathe: true };
const ANCHORS: Record<Anchor, true> = { none: true, tank: true, summoner: true };
const ENTRIES: Record<EntryPattern, true> =
  { far_front: true, flanks: true, surround: true, turrets_center: true };
const ROOM_KINDS: Record<RoomType, true> =
  { combat: true, elite: true, treasure: true, shop: true, rest: true, boss: true };
const FACTS: Record<CardFact, true> = {
  style: true, build: true, need: true, eases: true, synergy: true, upgrade: true,
  promised: true,
};
const ORIGINS: Record<CardOrigin, true> = {
  sampled: true, wildcard: true, pity: true, temptation: true, filler: true, forced: true,
  promised: true, guaranteed: true,
};
const PATHS: Record<FallbackPath, true> = {
  timeout: true, http: true, invalid: true, declined: true, late: true, retry_exhausted: true,
  commit_check: true, deadline: true, no_history: true,
};
const LANES: Record<AffixIntent, true> = {
  homing: true, cheaper: true, elemental: true, heavier: true, wider: true, survival: true,
};

/** Slots and spawn groups are declared per archetype rather than centrally. */
const slotIds = (pick: "zoneSlots" | "spawnGroups"): string[] => {
  const out = new Set<string>();
  for (const a of [...PLAYABLE_ARCHETYPES, ...BOSS_ARCHETYPES])
    for (const slot of (a as unknown as Record<string, readonly unknown[]>)[pick] ?? [])
      out.add(typeof slot === "string" ? slot : String((slot as { id: string }).id));
  return [...out];
};

/**
 * Every id the page can draw, with the field it is drawn under: `term` looks
 * for `term.<field>.<id>` before `term.<id>`, so a value that means two
 * things is allowed to say two things.
 */
const vocabulary = (): { id: string; field?: string }[] => {
  const out: { id: string; field?: string }[] = [];
  const add = (ids: readonly string[], field?: string) => {
    for (const id of ids) out.push(field === undefined ? { id } : { id, field });
  };
  // The state: every field, and every bucket it can be in.
  add(keysOf(LABELS));
  for (const [field, values] of Object.entries(LABELS as Record<string, readonly string[]>))
    add(values, field);
  // The rest of the state, which is history and code's own labels.
  add([
    "build_range", "build_gaps", "dominant_tags", "intent_preset",
    "typed_intent", "last_tension", "since_release", "last_room_kind", "damage_trend",
    "build_shape", "keys_lean", "off_style_picks", "mana_refused", "mana_short_time",
    "hits_per_shot", "cast_rate", "damage_rate", "sword_share", "hurt_by",
    "portal_count", "held_schools", "reward_kind", "card_facts", "room_type",
    "last_shapes", "zones", "spawn_groups", "open_ratio_label", "cover_label", "intent",
    "preset", "free_text", "pressure_cap", "range",
    // What the run has been offering and what the player does with it, and
    // what the last room looked like (`director/questions/history.ts`).
    "door_offered_running", "door_taken_lean", "door_skipped_most",
    "last_mood_temperature", "last_mood_brightness", "last_mood_particles", "last_symmetry",
    // The staff, as facts (`run/build-facts.ts`).
    "spell_levels", "affix_slots_open", "held_elements", "casts_per_bar", "mana_stats_taken",
    "held_spells",
  ]);
  for (const field of ["door_offered_running", "door_skipped_most"])
    add([...REWARD_KINDS, "none"], field);
  add([...REWARD_KINDS, "none", "mixed"], "door_taken_lean");
  add(["cold", "warm", "none"], "last_mood_temperature");
  add(["dim", "bright", "none"], "last_mood_brightness");
  add(["calm", "busy", "none"], "last_mood_particles");
  add([...keysOf(SYMMETRIES), "none"], "last_symmetry");
  add(["all_base", "some_raised", "mostly_raised"], "spell_levels");
  add(["none", "few", "many"], "affix_slots_open");
  add(["none", "one", "several"], "held_elements");
  add(["many", "some", "few"], "casts_per_bar");
  add(["none", "one", "several"], "mana_stats_taken");
  add(["just", "a_while", "long"], "since_release");
  add(["combat", "elite", "rest", "none"], "last_room_kind");
  add(["rising", "steady", "falling"], "damage_trend");
  add(["raw", "forming", "formed"], "build_shape");
  add([...ARCHETYPES, "mixed"], "keys_lean");
  add(["none", "one", "two_running"], "off_style_picks");
  add(["never", "sometimes", "often"], "mana_refused");
  add(["little", "some", "most"], "mana_short_time");
  add(["few", "one", "several"], "hits_per_shot");
  add(["slow", "steady", "rapid"], "cast_rate");
  add(["low", "fair", "high"], "damage_rate");
  add(["none", "some", "most"], "sword_share");
  add(["nothing", "shots", "blades", "hazards"], "hurt_by");
  add(["some", "none"], "build_gaps");
  add(["one", "two", "three"], "portal_count");
  add(["open", "mixed", "tight"], "open_ratio_label");
  add(["none", "sparse", "dense"], "cover_label");
  add(keysOf(FACTS).concat("plain"), "fact");
  // The room, as the page reads it back.
  add([
    "room", "encounter", "reward", "space", "symmetry", "size", "mood", "stage", "trimmed",
    "composition", "density", "waves", "wave_structure", "anchor", "entry", "pressure",
    "roster", "cards", "portals", "note", "tension",
  ]);
  add(["open_ratio", "pillar_count", "symmetry_error", "reachable_ratio", "obstacle_ratio",
    "mask_floor", "free_floor", "reachable_floor", "obstacle_cells"]);
  // Every option of every question.
  add([...PLAYABLE_ARCHETYPES, ...BOSS_ARCHETYPES].map((a) => a.id), "space");
  add(keysOf(SYMMETRIES), "symmetry");
  add(keysOf(SIZES), "size");
  add(keysOf(MOODS), "mood");
  add([...FEATURES.map((f) => f.id), "none"], "feature");
  add(slotIds("zoneSlots"));
  add(slotIds("spawnGroups"));
  add(keysOf(COMPS), "composition");
  add(keysOf(DENSITIES), "density");
  add(keysOf(WAVES), "wave_structure");
  add(keysOf(ANCHORS), "anchor");
  add(keysOf(ENTRIES), "entry");
  add(keysOf(ROOM_KINDS), "room_type");
  add([...SPELL_SCHOOLS], "spell_school");
  add([...STAT_FAMILIES], "stat_family");
  add([...REWARD_KINDS], "reward_kind");
  add(["elite", "none"], "elite_portal");
  add(["best", "raised"], "elite_grade");
  add(["ordinary", "raised"], "normal_grade");
  add(["merchant", "smith", "fountain", "none"], "npc_room");
  // The room an NPC stands in, as the plan page's portal list names it
  // unscoped (`NPC_ROOM_ID`): the smith's room has always been "blacksmith".
  add(["merchant", "blacksmith", "fountain"]);
  add(["low", "medium", "high"], "variety");
  add(keysOf(LANES), "affix_intent");
  add([...ELITE_AFFIX_IDS]);
  add([...ALL_ENEMY_IDS], "enemy");
  add([...ALL_TAGS]);
  // Who answered, why it fell back, and how a card came to be offered.
  add(["jev", "rule", "random", "code"]);
  add(keysOf(PATHS));
  add(keysOf(ORIGINS), "origin");
  add(["fallback"]);
  // The subjects the decisions column groups by.
  add([...CATEGORIES]);
  return out;
};

/**
 * Every question the Director can ask, named twice: the short label the row
 * carries and the sentence under it. `zone` and `blendedOffer` stand in for
 * the families whose names carry a slot or a shelf.
 */
const NAMES = [...new Set([...Object.keys(CATEGORY_OF), "zone", "blendedOffer"])];
/*
 * A name can carry a parenthetical saying how the answer was reached —
 * `next_tension (advisory)`, `elite_affixes (code draw)`. The page strips it
 * and says it beside the question (`questionBase`, `questionNote` in
 * `play.ts`), so the same two keys serve, plus one for the note itself. The
 * page used to strip `(code draw)` alone, and printed the raw key
 * `term.qs.next_tension (advisory)` across the answer column.
 */
const QUESTIONS = NAMES.map((name) =>
  name.replace(/^zone_.*/, "zone").replace(/\s*\([^)]*\)\s*$/, ""));
const NOTES = NAMES.flatMap((name) => {
  const found = /\(([^)]*)\)\s*$/.exec(name);
  return found ? [found[1]!.trim().toLowerCase().replace(/\s+/g, "_")] : [];
});

describe("the lines core produces", () => {

  it("has every key core can produce, in every language", () => {
    const keys = [...new Set(produced().map((p) => p.key))].sort();
    expect(keys.length).toBeGreaterThan(50);
    for (const lang of LANGS) {
      const table = stringTable(lang) as Record<string, string>;
      expect(keys.filter((k) => !table[k]), `${lang} is missing keys core produces`).toEqual([]);
    }
  });

  it("names every id an argument carries, in every language", () => {
    // `element`, `label` and `shapes` travel as ids and are named from a
    // table of their own. An id with no entry would print itself.
    const ids = new Set<string>();
    for (const { args } of produced())
      for (const [name, value] of Object.entries(args ?? {}))
        if (typeof value === "string" && ["element", "label", "shapes"].includes(name))
          for (const one of value.split(",")) ids.add(`${name}:${one}`);
    expect(ids.size).toBeGreaterThan(15);
    for (const lang of LANGS) {
      const table = stringTable(lang) as Record<string, string>;
      const missing = [...ids].filter((id) => {
        const [name, value] = id.split(":") as [string, string];
        if (name === "element") return !table[`element.${value}`];
        if (name === "shapes") return !table[`shape.${value}`];
        return !table[`statlabel.${value}`];
      });
      expect(missing, `${lang} is missing ids`).toEqual([]);
    }
  });

  it("leaves no placeholder unfilled in any language", () => {
    try {
      for (const lang of LANGS) {
        setLang(lang);
        for (const item of ITEMS.values())
          for (const part of offerStatParts(item))
            expect(localizeStat(part), `${lang} ${item.id} ${part.key}`).not.toMatch(/\{\w+\}/);
        for (const up of STAT_UPGRADES)
          expect(localizeStat({ ...statLinePart(up) }), `${lang} ${up.id}`).not.toMatch(/\{\w+\}/);
        for (const a of SPELL_AFFIXES)
          expect(localizeStat(affixFitsPart(a)), `${lang} ${a.id}`).not.toMatch(/\{\w+\}/);
      }
    } finally {
      setLang("en");
    }
  });

  it("says the English exactly as core wrote it", () => {
    // The one language that must not move: the harness compares against it.
    try {
      setLang("en");
      for (const item of ITEMS.values())
        for (const part of offerStatParts(item))
          expect(localizeStat(part), item.id).toBe(part.text);
      for (const up of STAT_UPGRADES) {
        const p = statLinePart(up);
        expect(localizeStat(p), up.id).toBe(p.text);
      }
      for (const a of SPELL_AFFIXES) {
        const p = affixFitsPart(a);
        expect(localizeStat(p), a.id).toBe(p.text);
        expect(localizeStat({ text: a.text, key: affixTextKey(a.id) }), a.id).toBe(a.text);
        for (const part of affixStatParts(a))
          expect(localizeStat(part), `${a.id} ${part.key}`).toBe(part.text);
      }
    } finally {
      setLang("en");
    }
  });

  it("actually translates, rather than falling back to English", () => {
    // A key missing from zh falls back to English and looks fine on screen;
    // this is what notices. Every part of a Chinese line is Chinese.
    try {
      setLang("zh");
      const fire = ITEMS.get("ember_dart");
      if (!fire) throw new Error("no ember_dart");
      for (const part of offerStatParts(fire))
        expect(localizeStat(part), part.key).toMatch(/[一-鿿]/);
    } finally {
      setLang("en");
    }
  });
});

describe("t", () => {
  it("fills placeholders and leaves unknown ones alone", () => {
    expect(t("over.diedInValue", { room: 3, type: "Combat" })).toBe("Floor 3 · Combat");
    expect(t("over.diedInValue", { room: 3 })).toContain("{type}");
  });

  it("leaves keycap and icon markup untouched", () => {
    expect(t("prompt.open")).toBe("[@interact] Open");
    expect(t("char.price", { price: 25, held: 100 })).toContain("{coin}");
  });
});

describe("fontPx", () => {
  it("snaps the RENDERED size to the pixel font's 12, not the authored one", () => {
    // The bug this replaced: snapping 7 to 12 made every Chinese label
    // nearly twice the size of the English it stood in for.
    // Every language snaps now — Latin is a 12 px pixel face too.
    for (const [px, zoom] of [[7, 8], [9, 8], [6, 4], [13, 6]] as const) {
      const out = fontPx(px, zoom);
      expect(Math.round(out * zoom) % 12, `${px}@${zoom}`).toBe(0);
    }
  });

  it("never renders below two multiples, which is unreadable", () => {
    // Ark Pixel puts 0.83 of its em into ink against the system font's 0.94,
    // so the same nominal size reads visibly smaller; one multiple of 12 is
    // not a size anyone can read at a glance.
    expect(fontPx(1, 1) * 1).toBe(MIN_RENDERED_PX);
    expect(bodyPx(1, 1) * 1).toBe(MIN_BODY_PX);
  });

  it("floors prose higher than markers", () => {
    // A hint row and a corner count can be small; a sentence cannot.
    expect(bodyPx(4, 4) * 4).toBeGreaterThanOrEqual(MIN_BODY_PX);
    expect(fontPx(4, 4) * 4).toBeGreaterThanOrEqual(MIN_RENDERED_PX);
  });
});

describe("player-facing descriptions", () => {
  /*
   * Core's descriptions are written for the Director — which build a spell
   * suits, which bottleneck it answers — and read as design notes on a card.
   * Every language, English included, has its own text for the player.
   */
  const ids = [
    ...[...ITEMS.values()].map((i) => i.id),
    ...SPELL_AFFIXES.map((a) => a.id),
    ...STAT_UPGRADES.map((u) => u.id),
  ];

  it("has a description for every spell, affix and stat in every language", () => {
    for (const lang of LANGS) {
      const table = contentTable(lang);
      const missing = ids.filter((id) => !table[id]?.description);
      expect(missing, `${lang} descriptions`).toEqual([]);
    }
  });

  it("never shows the Director's vocabulary to the player", () => {
    const director = /\b(bottleneck|suits an? \w+ build|fills the \w+ role|mana sustain|in its scope)\b/i;
    for (const id of ids) {
      const text = contentTable("en")[id]?.description ?? "";
      expect(director.test(text), `${id}: ${text}`).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------------ *
 * The Director's vocabulary.
 *
 * The room plan page shows what the Director was asked and what it answered,
 * and every word of it is an id: a state field, the bucket it was in, a
 * question, an option. The ids stay English on the wire (doc 002) and are
 * translated only where they are drawn, so the one way this rots is an id
 * core gains that no table has ever heard of — which prints itself, in
 * English, in the middle of a Chinese page.
 *
 * Each list below is either read out of core's own export or written as a
 * `Record` over core's own union, so a value added to either fails to
 * compile rather than failing to translate.
 * ------------------------------------------------------------------------ */
describe("the Director's vocabulary", () => {

  it("names every state field, bucket and option in every language", () => {
    const missing: Record<string, string[]> = {};
    for (const lang of LANGS) {
      const table = stringTable(lang) as Record<string, string>;
      const gone = vocabulary().filter(({ id, field }) =>
        !table[`term.${id}`]
        && !(field && table[`term.${field}.${id}`])
        // Spells, affixes, stats and schools are named in the content tables,
        // which the `content tables` suite already covers.
        && !contentTable(lang)[id]?.name);
      if (gone.length) missing[lang] = gone.map((x) => (x.field ? `${x.field}:${x.id}` : x.id));
    }
    expect(missing).toEqual({});
  });


  it("names every question, twice, in every language", () => {
    const missing: Record<string, string[]> = {};
    for (const lang of LANGS) {
      const table = stringTable(lang) as Record<string, string>;
      const gone = [...new Set(QUESTIONS)].flatMap((q) => [
        ...(table[`term.q.${q}`] ? [] : [`term.q.${q}`]),
        ...(table[`term.qs.${q}`] ? [] : [`term.qs.${q}`]),
      ]);
      if (gone.length) missing[lang] = gone;
    }
    expect(missing).toEqual({});
  });

  it("says a blended offer's shelf in the player's language", () => {
    /*
     * The offer's own "question" is named by `play.ts` — `blended offer: spell`
     * — and the page says the part after the colon through `term`. It used to
     * be English prose (`spell cards`, `shelf: stat`), which no table has ever
     * heard of, so the row read "混合提议 · spell cards" on a Chinese page.
     */
    try {
      for (const lang of ["zh", "ja"] as const) {
        setLang(lang);
        for (const kind of REWARD_KINDS) {
          const said = questionName(`blended offer: ${kind}`);
          expect(said, `${lang} ${kind}`).not.toMatch(/[A-Za-z]/);
        }
      }
    } finally {
      setLang("en");
    }
  });

  it("names how an answer was reached, where the question says so", () => {
    const missing: Record<string, string[]> = {};
    for (const lang of LANGS) {
      const table = stringTable(lang) as Record<string, string>;
      const gone = [...new Set(NOTES)].filter((n) => !table[`term.qnote.${n}`]);
      if (gone.length) missing[lang] = gone;
    }
    expect(missing).toEqual({});
    // The two the Director actually emits beside those in `CATEGORY_OF`.
    for (const lang of LANGS)
      for (const note of ["advisory", "code_draw", "from_the_need_ranking"])
        expect((stringTable(lang) as Record<string, string>)[`term.qnote.${note}`], `${lang}:${note}`).toBeTruthy();
  });

  it("says a Chinese page in Chinese, not in ids", () => {
    // The whole point: `term` falling through to the id is the failure this
    // catches, and it looks fine to anyone reading the English.
    try {
      setLang("zh");
      for (const [id, field] of [["open_arena", "space"], ["pre_boss", "run_progress"],
        ["melee_heavy", "composition"], ["rapid", "cast_rate"], ["steady", "wave_structure"]] as const)
        expect(term(id, field), id).toMatch(/[一-鿿]/);
      expect(term("mid", "run_progress")).not.toBe(term("mid", "build_range"));
    } finally {
      setLang("en");
    }
  });

  it("never shows a door or portal label as its id", () => {
    /*
     * The report this catches: a stat portal floating "Survival" over itself
     * in Chinese, because the label was the `StatFamily` id in Title Case.
     * Every kind of thing a door can promise goes through the same check.
     */
    const labels = [
      ...[...STAT_FAMILIES].map((f) => ["stat_family", f] as const),
      ...[...SPELL_SCHOOLS].map((s) => ["spell_school", s] as const),
      ...[...REWARD_KINDS].map((k) => ["reward_kind", k] as const),
      ...(["merchant", "smith", "fountain"] as const).map((n) => ["npc_room", n] as const),
      ...(["elite", "boss", "shop", "rest", "combat"] as const).map((r) => ["room_type", r] as const),
    ];
    try {
      for (const lang of ["zh", "ja"] as const) {
        setLang(lang);
        const english: string[] = [];
        for (const [field, id] of labels) {
          const said = term(id, field);
          // An id that fell through prints itself, underscores opened out.
          if (said === id || said === id.replace(/_/g, " ")) english.push(`${field}:${id}`);
        }
        expect(english, `${lang} shows ids`).toEqual([]);
      }
    } finally {
      setLang("en");
    }
  });

  it("leaves the ids themselves alone", () => {
    // `term` is display only. Nothing it does may change what a request says,
    // so the English of an id is still recognisably that id.
    setLang("en");
    expect(term("open_arena")).toBe("open arena");
    expect(term("stat+spell+gold")).toBe("stat + spell + gold");
  });
});

describe("wrapText", () => {
  /*
   * The style cards on the new-run screen read "fan ou / t." and "fight / s.":
   * the CJK rule — break between any two characters — was being applied to
   * Latin, by way of the kinsoku branch that pushes a full stop onto the next
   * line with the character before it. A Latin line breaks at a space.
   */
  const lines = (s: string, maxPx: number): string[] => {
    setLang("en");
    return wrapText(s, maxPx, 6, letterSpacing()).split("\n");
  };

  it("never splits a Latin word", () => {
    for (const s of [
      "Many cheap casts, kept up. Fast spells that chain and fan out.",
      "Few big hits, placed well. Slow, expensive spells that end fights.",
      "Live in sword range. Spells that circle and strike close.",
    ]) {
      for (const width of [40, 60, 92, 120]) {
        const rows = lines(s, width);
        // Every row joins back into the original, with the break landing on a
        // space: no row starts or ends inside a word.
        expect(rows.join(" ").replace(/ +/g, " "), `${s} @ ${width}`).toBe(s);
      }
    }
  });

  it("breaks after a hyphen, keeping the hyphen on the upper row", () => {
    // Narrow enough that the compound cannot sit on one row.
    const rows = lines("hit-and-run", 22);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.join("")).toBe("hit-and-run");
    for (const r of rows.slice(0, -1)) expect(r.endsWith("-"), r).toBe(true);
  });

  it("cuts a word that is wider than the whole column", () => {
    const rows = lines("supercalifragilisticexpialidocious", 30);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.join("")).toBe("supercalifragilisticexpialidocious");
  });

  it("still breaks Chinese and Japanese between characters", () => {
    for (const [lang, text] of [["zh", "大量廉价施法，持续不断。快速法术会连锁并散开。"], ["ja", "安い呪文を数多く、絶え間なく。連鎖し広がる速い呪文。"]] as const) {
      setLang(lang);
      const rows = wrapText(text, 40, 6, letterSpacing()).split("\n");
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.join("")).toBe(text);
      // Kinsoku: a closing mark never opens a row.
      for (const r of rows) expect("、。，．）」』".includes(r[0] ?? ""), `${lang}: ${r}`).toBe(false);
    }
    setLang("en");
  });
});

/* ------------------------------------------------------------------------ *
 * What the Director actually emitted.
 *
 * The suite above is a hand-kept list of every id the page can draw, and it
 * has caught a lot — but a hand-kept list is exactly what drifts, and the way
 * it drifts is the way it drifted: the Director started naming an answer
 * `next_tension (advisory)`, no table had heard of it, and the plan page
 * printed `term.qs.next_tension (a…` across a Chinese row. Nothing here could
 * have known.
 *
 * So this one asks the Director. It plans a room and a set of portals on both
 * state formats, collects every question name and every state key the
 * requests actually carried, and checks each against the three tables through
 * the same functions the page uses. A question the Director gains fails here
 * the first time it is asked.
 * ------------------------------------------------------------------------ */
describe("every key the Director emits", () => {
  /** Every request a room and a portal offer make, on one state format. */
  async function emitted(format: "labels" | "briefing"): Promise<ObservedRequest[]> {
    const seen: ObservedRequest[] = [];
    const evaluate: Evaluator = async (req) => {
      const answers: Record<string, ChoiceAnswer> = {};
      for (const [name, q] of Object.entries(req.questions)) {
        const keys = Object.keys(q.criteria);
        answers[name] = {
          choice: keys[0]!,
          probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0])),
          confidence: 0.9,
        };
      }
      return { answers, usage: { input_tokens: 1 } };
    };
    const ctx: RunContext = {
      run_id: "t", seed: "t", room_index: 9,
      health: 40, max_health: 60, gold: 50,
      labels: {
        health: "ok", recent_damage: "some", clear_speed: "normal",
        movement_pressure_recent: "light", run_progress: "mid", gold: "ok",
        tension_cap: "peak_allowed", hazard_cap: "high", pressure_cap: 5,
        build: { range: "mid" },
        preference: { dominant: ["spam"], consistency: "on_plan" },
      },
      staff: runStaff(),
      slots: [null, null, null],
      inventory: [],
      history: emptyHistory(),
      intent: { preset: "spam", free_text: "I keep running out of mana" },
    };
    const director = createDirector("jev", {
      evaluate, state_format: format, observe: (r) => seen.push(r),
    });
    await director.planRoom(ctx, { room_index: 9, door_slot: 0, room_type: "combat" }, "build");
    await director.planPortals(ctx, portalChoices(
      { roomIndex: 9, lastWasElite: false, critical: false, style: "spam", hurt: true },
      new RngSource("t").stream("portal-count", 9),
    ));
    return seen;
  }

  /** The keys of a nested state, as `director-readout.ts` flattens them. */
  function flatKeys(state: Readonly<Record<string, unknown>>, prefix = ""): string[] {
    return Object.entries(state).flatMap(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k;
      return v && typeof v === "object" && !Array.isArray(v)
        ? flatKeys(v as Record<string, unknown>, key) : [key];
    });
  }

  let requests: ObservedRequest[] = [];
  beforeAll(async () => {
    requests = [...await emitted("labels"), ...await emitted("briefing")];
  });

  it("makes requests at all, on both state formats", () => {
    expect(requests.length).toBeGreaterThan(3);
  });

  it("has a short label and a sentence for every question it asked", () => {
    const names = new Set(requests.flatMap((r) => Object.keys(r.questions)));
    // Every decision's own name too: some are code's (`elite_kind (from the
    // need ranking)`) and never appear as a question in a request.
    for (const extra of ["next_tension (advisory)", "elite_affixes (code draw)", "elite_kind (from the need ranking)"])
      names.add(extra);
    const missing: string[] = [];
    for (const lang of LANGS) {
      setLang(lang);
      try {
        for (const name of names) {
          const said = questionName(name);
          if (!said || said.includes("term.q")) missing.push(`${lang}: ${name} -> ${said}`);
        }
      } finally { setLang("en"); }
    }
    expect(missing).toEqual([]);
  });

  it("has a word for every state field it sent", () => {
    const keys = new Set(requests.flatMap((r) => flatKeys(r.state)));
    expect(keys.size).toBeGreaterThan(5);
    const missing: string[] = [];
    for (const lang of LANGS) {
      setLang(lang);
      try {
        for (const key of keys) {
          // The three the page renders by hand, and the briefing, which is a
          // quotation rather than a field (`statePlanLines`).
          if (key === "briefing" || key === "intent.free_text") continue;
          if (key.startsWith("card_facts.") || key.startsWith("held_spells.")) continue;
          const field = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
          const said = term(field);
          if (said === field && /_/.test(field)) missing.push(`${lang}: ${key}`);
        }
      } finally { setLang("en"); }
    }
    expect(missing).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ *
 * The key set against the code that uses it.
 *
 * Two rots the suites above cannot see. A key **nobody asks for** is dead
 * weight that three people keep translating — the tables carried
 * `plan.answer` and `plan.confidence` for a page that had stopped drawing
 * them. A key the code asks for and **no table has** prints its own name on
 * screen; `t` is typed against `EN`, so a literal cannot miss, but the page
 * builds keys at run time too (`shape.${sh}`, `plan.note.${key}`) and casts
 * them past the type.
 *
 * Both are answered by reading the package's own source, so neither depends
 * on anyone remembering to update a list here.
 * ------------------------------------------------------------------------ */
describe("the key set and the code that uses it", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const GAME_SRC = dirname(HERE);
  /** The tables themselves: every key is spelt there, so they prove nothing. */
  const TABLES = /\/i18n\/(en|zh|ja|terms-(en|zh|ja)|content-(en|zh|ja))\.ts$/;

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const at = join(dir, e.name);
      if (e.isDirectory()) return walk(at);
      return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !TABLES.test(at) ? [at] : [];
    });

  /** Everything the game ships, as one string to search. */
  const CODE = walk(GAME_SRC).map((f) => readFileSync(f, "utf8")).join("\n");
  /*
   * And the packages behind it. Core names the key of every number line it
   * writes (`key: "stat.casts"`), so core is a reader of this table too — and
   * a line it only writes down one branch is still a line a card can show.
   */
  const BEHIND = ["core", "director"]
    .map((pkg) => join(dirname(dirname(GAME_SRC)), pkg, "src"))
    .flatMap(walk).map((f) => readFileSync(f, "utf8")).join("\n");

  /**
   * The prefixes the code builds a key from at run time, read off the calls
   * that build them rather than listed by hand.
   *
   * `term.` is left out on purpose: `term()` looks up `term.<id>` for any id
   * at all, so counting it would excuse every key in `terms-en.ts`. Those are
   * checked against the Director's own vocabulary instead, below.
   */
  const prefixes = (): string[] => {
    const out = new Set<string>();
    for (const re of [/\bt\(\s*`([^`$]*)\$\{/g, /\blookup\(\s*`([^`$]*)\$\{/g, /\bsaidKey\(\s*"([^"]+)"/g])
      for (const m of CODE.matchAll(re)) out.add(m[1]!);
    out.delete("term.");
    return [...out].filter((p) => p.length > 0);
  };

  /** Every `term.*` key the plan page can actually reach. */
  const termKeys = (): Set<string> => {
    const out = new Set<string>();
    for (const { id, field } of vocabulary()) {
      out.add(`term.${id}`);
      if (field) out.add(`term.${field}.${id}`);
    }
    for (const q of QUESTIONS) { out.add(`term.q.${q}`); out.add(`term.qs.${q}`); }
    for (const n of [...NOTES, "advisory", "code_draw", "from_the_need_ranking"])
      out.add(`term.qnote.${n}`);
    return out;
  };

  it("has a reader for every key it defines", () => {
    const dyn = prefixes();
    const reachable = termKeys();
    const fromCore = new Set(produced().map((p) => p.key));
    const dead = Object.keys(EN).filter((key) =>
      !CODE.includes(`"${key}"`)
      && !CODE.includes(`\`${key}\``)
      && !BEHIND.includes(`"${key}"`)
      && !fromCore.has(key)
      && !reachable.has(key)
      && !dyn.some((p) => key.startsWith(p)));
    expect(dead, "keys no screen can ask for").toEqual([]);
  });

  it("defines every key the code asks for", () => {
    /*
     * A literal `t("…")` is already a type error when it is missing, but a
     * key built from a template and cast — `t(\`shape.${shape}\` as StringKey)`
     * — is not, and neither is one named in a table of `StringKey`s that has
     * drifted. Both are literals in the source, so both are checked here.
     */
    const asked = new Set<string>();
    for (const re of [/\bt\(\s*"([^"]+)"/g, /"([\w]+(?:\.[\w]+)+)" as StringKey/g])
      for (const m of CODE.matchAll(re)) asked.add(m[1]!);
    expect(asked.size).toBeGreaterThan(50);
    expect([...asked].filter((k) => !(k in EN)), "keys no table has").toEqual([]);
  });

  it("carries nothing in the content tables the game cannot look up", () => {
    // A content id is looked up by the id core already gave the thing. An
    // entry under an id nothing produces — `room.combat`, `rarity.epic` —
    // is a translation that will never be read.
    const known = new Set<string>([
      ...ITEMS.keys(),
      ...SPELL_AFFIXES.map((a) => a.id),
      ...STAT_UPGRADES.map((s) => s.id),
      ...SPELL_SCHOOLS,
      ...["spam", "nuke", "area", "dot", "melee"].map((s) => `style.${s}`),
    ]);
    for (const lang of LANGS) {
      const extra = Object.keys(contentTable(lang)).filter((id) => !known.has(id));
      expect(extra, `${lang} names ids nothing asks for`).toEqual([]);
    }
  });
});
