---
id: 010
title: Content Ontology and Description Generation
status: proposed
date: 2026-09-21
summary: One closed vocabulary shared by summarizers, content tags, option descriptions and instructions. Common schema fields for every content entry. A description generator that composes a static sentence with state-dependent and best-placement delta sentences from templates, so Jev always sees the basis for a decision in the same words the state uses. Versioned for traces.
depends_on: [002, 004, 005, 006, 007]
---

# 010 Content Ontology and Description Generation

## Why

Jev sees only words. json-render put every fact Jev needed into candidate descriptions, down to the numbers. Here the words in `state` and the words in option descriptions must be the same closed vocabulary, or instructions like "prefer options marked matches_tension" have nothing to bind to.

## Summary labels (emitted by summarizers, allowed in state)

| Field | Levels |
|---|---|
| health | critical / low / ok / full |
| recent_damage | none / some / heavy |
| clear_speed | slow / normal / fast |
| movement_pressure_recent | light / heavy |
| run_progress | early / mid / late / pre_boss |
| gold | poor / ok / rich |
| tension | release / build / peak |
| tension_cap | release_only / build_allowed / peak_allowed |
| hazard_cap | none / low / high |
| build.archetype | spam / nuke / area / dot / mixed |
| build.bottleneck | damage / cast_frequency / mana / accuracy / none |
| build.mana_sustain | starved / tight / comfortable |
| build.range | short / mid / long |
| scatter (from the build simulator) | tight / medium / wide |
| build.missing_roles | subset of roles below |
| preference.consistency | on_plan / drifting / pivoted |
| suitability (per encounter option) | softer_than_tension / matches_tension / harder_than_tension |
| counter_score (per encounter option) | favours / neutral / counters |

Bucketing thresholds live in `summarizer.ts` and nowhere else.

## Content tags

| Dimension | Values | Used by |
|---|---|---|
| role | attack, boost, passive, payload, multicast, engine, control, sustain, tracking, mana_regen | items |
| range | short, mid, long | items, enemies |
| element | fire, poison, ice, none | items, enemies |
| archetype | spam, nuke, area, dot, melee | items, presets, intent styles |
| pressure_kind | movement_pressure, ranged_pressure, melee_heavy, ranged_heavy, area_denial | encounters, features |
| hazard | hazard, slow_zone, damage_zone, cover, utility | features |
| rarity | common, uncommon, rare | items |

`build.archetype` adds `mixed` as a summarizer-only level; no item is tagged `mixed`.

## Common schema fields

```ts
interface ContentBase {
  id: string;                  // snake_case, unique across libraries
  tags: string[];              // from the vocabulary
  description: string;         // static sentence(s), present tense
  jev_hints?: { favor_when?: Label[]; avoid_when?: Label[] };   // bare field labels from the table above, e.g. "bottleneck:accuracy"
  resource?: string;           // mutual exclusivity group
  numeric_ok?: boolean;        // allows digits in description (e.g. "+1 projectile")
}
```

`jev_hints` never reach Jev as fields; the generator turns them into sentences.

## Description rules

1. Name and effect in one clause.
2. Second clause: who it suits or hurts, using label words.
3. Digits only when the number is the decision and `numeric_ok` is set.
4. No evaluative adjectives without a comparison ("highest single-hit damage in the pool" is fine, "powerful" is not).
5. Static part under 220 characters.

## Description generator

`describe(entry, ctx) → string` joins:

1. The static `description`.
2. **State sentences** for each `jev_hints` label that matches the current labels, from templates in `director/describe.ts`: `favor_when bottleneck:accuracy` → "Directly addresses the current accuracy bottleneck." Hints use the bare field name; the matcher flattens the state to both the nested path and the bare name, so a hint author never needs to know where a label sits in the state object.
3. For items, the **best-placement delta sentence** from 006: label transitions between the build the player holds and the best legal arrangement with the item, e.g. "Would move mana sustain from tight to starved." At most two transitions, the most important first (bottleneck, then mana_sustain, then archetype, then scatter).
4. For encounter options, the **suitability** word from 005 appended as a sentence.

The state sentences are a table, one per label reference, in `director/describe.ts`. Delta and suitability sentences are composed from the label words themselves, so a new level needs no new template. A `short` form drops the hint and delta sentences, for the narrow reward axes (007).

## Instructions

All `instructions` strings are templates with label slots, written in the Director's question builders (`questions/*.ts` and `director.ts`). No instruction text is typed where the game asks for a plan.

## Versioning

`content_hash` (all content JSON), `prompt_hash` (all templates and instructions) and `model` are attached to every trace (011). Any edit to a template changes `prompt_hash`, so metric shifts can be attributed.

## Checks in `pnpm content:check`

- Every tag in the vocabulary; every `jev_hints` label in the summary-label table.
- Description rules 3 and 5 enforced mechanically.
- Every `resource` shared by at least two entries: a group of one cannot express exclusivity.
- Ids lower snake_case and unique both within a library and across all of them.

`missingSentences` reports any hint with no state sentence, so a hint that would silently do nothing fails its test rather than shipping.
