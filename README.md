# jev-rogue

**English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

A top-down action room roguelike directed by [Jev](https://docs.typesafe.ai/), TypeSafe AI's choice model. Jev decides which of the game's *legal* design options fit the current run. The game still generates its own rooms, encounters, rewards, and combat.

## Trailer

A run in under thirty seconds: pick a style and say what you want, fight, then watch Jev pick the reward cards and the next doors.

https://github.com/user-attachments/assets/6b883b46-4f20-42e2-b602-acdb12c0e31d

## Why Jev?

AI can play games on a person's behalf. That is not the future this project is looking for. If AI takes over the leisure while people keep doing the work, it feels more like a dystopia. The more interesting direction is **AI helping make the game, with people still playing it**.

Jev therefore takes the role of a Director, never the player's hands. It reads the state of a run and judges bounded choices about the next room, encounter, and reward. Code turns those choices into a playable world; the human explores, fights, chooses, and lives with the outcome. Jev's choice model suits this role because it can read the player's context while answering only from options the game has already made safe and possible. The hope is that each run feels shaped for a person, while the pleasure and agency of playing remain theirs.

## Core idea

**Jev decides the parameters; algorithms generate the room.** A procedural roguelike already has code that builds maps, assembles encounters, and selects rewards. It also has a policy—often weighted tables and `if` statements—that chooses what parameters to give those generators. In the Jev arm, this project gives the *experience-preference* part of that policy to Jev while keeping the generators.

Jev reads the player's stated style alongside what they actually do: held spells and upgrades, recent combat, and rewards taken or passed over. Code first offers only legal, fair, in-budget choices. Jev judges which of those choices fit the player; code draws from its probabilities. For example, Jev may favor an `open_arena` with asymmetric symmetry and a warm mood. The room generator then places the actual floor and cover, checks reachability and measurements, and retries or uses a fallback if needed. A later decision chooses encounter parameters for the room that was generated. Jev never returns a tile map.

The aim is a run that responds to the player **without removing uncertainty or challenge**: their build remains usable, but a favorable room or reward is not guaranteed. Numeric balance, safety limits, exact placement, and seeded randomness remain in code. This is the [design principle in 001](docs/planning/001-vision-and-scope.md), the [three-layer split in 002](docs/planning/002-jev-integration-principles.md), and the [room-generation contract in 004](docs/planning/004-room-generation.md).

## Architecture at a glance

```text
Run and combat facts
  → summarize current state
  → enumerate legal options
  → Jev returns probabilities for named choices
  → seeded code samples an answer
  → code generates and validates the playable result
  → fixed-step simulation runs; Phaser renders it
```

| Part | Responsibility |
|---|---|
| [`packages/core`](packages/core) | Pure TypeScript simulation, room and encounter generators, spells, run state, constraints, and seeded randomness. No DOM or Phaser. |
| [`packages/director`](packages/director) | Builds Jev's state and questions, checks answers, samples decisions, and turns them into room and reward plans. |
| [`packages/game`](packages/game) | Phaser input, rendering, audio, menus, and the browser-side evaluator. It does not own combat rules. |
| [`packages/harness`](packages/harness) | Headless tests, balance runs, request traces, and asset checks over the same core. |
| [`server/worker.ts`](server/worker.ts) | Stateless proxy that adds the TypeSafe API key server-side. The key is never bundled into the browser. |

The simulation runs at a fixed 60 Hz step. Jev is consulted when a room or offer is planned, not each frame. This keeps the action deterministic for a run seed and lets the headless harness execute the same combat code as the game.

## What Jev does in this game

**Decisions are Jev's; generation and hard rules are code's.** Code first calculates the player's situation and removes impossible options. Jev then returns a distribution over the remaining options. Code samples from that distribution and checks the completed plan. Jev does not place tiles, create enemies or spells, calculate damage, or write game content.

For a combat room, the Director asks in two rounds as the room begins, and once more when its way out opens:

1. **High-level direction:** tension, room space, size, symmetry, and mood.
2. **After the room shape is known:** zones and encounter details such as composition, density, waves, entry, variants, and elite presence. Questions that depend on earlier answers are built only after those answers exist.
3. **When the reward is taken:** the doors out, and for every kind a door could be, the cards the room behind it will offer. The doors rise pending and turn while Jev answers, then open badged with every spell school or stat family among their cards. Decided here rather than as the room began, they read the fight just played and the build just changed ([finding 34](docs/research/jev-findings.md#finding-34)).

The browser normally sends Jev a structured plain-English **briefing**. It describes the game, chosen play style, held spells and upgrades, recent combat measurements, offers taken or skipped, room history, current health and gold, and what this request is deciding. It gives Jev **neutral facts**—for example, “lost 9 of 60 health”—rather than a verdict such as “struggling” or “needs mana.” Otherwise a human-written judgment would quietly decide the answer before Jev does. `?state=labels` switches to the compact label-table format for comparison; the rule-based control always reads those labels.

Here is a shortened example of one real question shape. The full request carries a longer briefing and more detailed option text. Jev receives the IDs in `criteria`, so it can only answer from options the game supplied:

```json
{
  "state": {
    "briefing": "The player: Barrage style. The build: three spell keys. Right now: 45 of 60 health, 38 gold, room 4 of 16. ..."
  },
  "questions": {
    "portal_need": {
      "type": "choice",
      "instructions": "Which reward does this player need most right now? ...",
      "criteria": {
        "spell": { "what": "A new spell or a level for one held.", "not_for": "Three full, raised keys." },
        "affix": { "what": "A modifier for a held spell.", "not_for": "No affix slots left." },
        "stat": { "what": "A permanent player upgrade.", "not_for": "An empty spell key remains empty." },
        "gold": { "what": "A purse to spend later.", "not_for": "Already enough to buy everything ahead." },
        "fallback": { "what": "None of these fits; let the game decide." }
      }
    }
  }
}
```

A response contains `answers.portal_need.choice`, a probability for **every** offered ID, and a confidence value computed from how the probabilities are spread. For example, `spell: 0.55`, `affix: 0.20`, `stat: 0.15`, `gold: 0.08`, `fallback: 0.02` sums to 1. The game validates the distribution and removes the escape option. For a question with one answer it reads the answer the way TypeSafe documents it: Jev's `choice` when the confidence is at least 0.5, and a seeded draw from Jev's distribution as given when it is lower, so Jev's own hesitation is where a run varies ([finding 33](docs/research/jev-findings.md#finding-33)). A ranking such as `portal_need` is drawn with a seed: a stronger first door and broader, distinct later doors. If Jev declines, times out, or returns an invalid answer, the affected decision uses the rule table. The flat-random arm is a separate experimental baseline, not a fallback.

The complete request and response contract, decision schedule, validation, sampling, and failure paths are in [How Jev directs a run](docs/architecture.md) ([中文](docs/architecture.zh-CN.md) · [日本語](docs/architecture.ja.md)). The measured behavior and design changes are in [Jev findings](docs/research/jev-findings.md).

### Inspect a decision in the game

Open the top-right **DEBUG** button (or press the backtick key) and select **DIRECTOR**. Expand **state as sent** and **questions as sent** to see the full briefing, instructions, and options for a Jev-sourced request. The sidebar also shows the distributions used for planning, sampled choices, source and fallback status, latency, and token usage. A request answered by the rule arm is marked as such; its displayed state is the one that arm read.

## Run locally

The rule Director runs without an API key:

```sh
pnpm install
pnpm dev
```

To try the Jev Director locally, add your own TypeSafe key to the git-ignored `.env.local`, start the dev server, and turn **Jev Director** on in the title menu:

```sh
echo 'TYPESAFE_API_KEY=...' >> .env.local
pnpm dev
```

The local Vite server exposes the stateless proxy at `/api/decide`, so the key stays outside client code. The game uses the rule Director by default. `?director=jev` and `?director=random` select other arms; `?seed=...` fixes the run seed for reproduction.

## Evidence and verification

### Transferable Jev findings

Nine lessons from the [full Jev findings log](docs/research/jev-findings.md) apply beyond this game:

1. [Give every question a “none of these” option (finding 0)](docs/research/jev-findings.md#finding-0). Jev always distributes probability across the options it receives, even when none fits. An explicit escape option lets the caller detect that case and use a fallback; a peaked distribution alone cannot prove that an option fits. In this project, the first room's questions about a previous room declined because that history did not exist.
2. [Give Jev neutral observations, not verdicts (finding 16)](docs/research/jev-findings.md#finding-16). State should report measured facts and precomputed counts without arguing for an answer. After we removed emphatic judgments from the briefing, even untargeted answers changed: `mood_particles: calm` fell from 91% to 72%, and `stat_family: survival` fell from 75% to 42%. Recheck every question when shared state wording changes.
3. [Enforce sequence requirements in code, unless the state prints the sequence (findings 5 and 32)](docs/research/jev-findings.md#finding-32). A stateless classification cannot see its own streaks: the longest run of one door kind was 5 with a code cap, 7 without it, and 10 after we asked for variety in the prompt. Once the briefing printed each room as it was built, one even-handed sentence in an instruction — naming where the run is in the state, and saying it weighs nothing before there is one — cut the mass on the previous spell school from 0.87 to 0.46. The same idea worded generically pushed answers away from the player's style even in the first room. A list of Jev's own earlier answers made streaks worse ([finding 31](docs/research/jev-findings.md#finding-31)).
4. [Emphatic narration raises the option it dwells on; neutral counts do not (finding 5a)](docs/research/jev-findings.md#finding-5a). Holding one state fixed and varying a single sentence, `affix` got 3% with nothing added, 78% after "the player has said they want more affixes", and 44% after "over the last 4 rooms the player chose the spell or stat door every time, never the affix door" — a sentence about *avoiding* it. The same history as plain counts ("Doors taken in the last 4 rooms: spell 2, stat 2") left it at 3%. A player's own stated wish, negation included, is read exactly; intensifiers such as "every time", "never" and "always", and sentences built around one option, argue for that option.
5. [Print a count in the direction the options ask about (finding 30)](docs/research/jev-findings.md#finding-30). Jev does no arithmetic. The options asked how many recent picks were *off* the player's style, but the state printed "tagged with the stated style: 0 of 3", and more off-style picks produced *more* of the "stay on style" answer. Printed as "off the stated style: N of 3", with each option carrying that line at its own value as an example, the answer tracked the count almost as a lookup (0 of 3 → `low` 1.00; 2 or 3 of 3 → `high` 0.58–1.00).
6. [Use examples only where options differ by which fact applies (finding 3)](docs/research/jev-findings.md#finding-3). Where options differ by what they *are*, examples are noise and overfit. Where they differ only by which value of one state line applies, an example is how Jev learns the mapping: deleting the two examples from one question, nothing else changed, moved it from 56% on one answer to 99% on another.
7. [Measure a wording change as an A/B over logged requests (finding 28)](docs/research/jev-findings.md#finding-28). Replay the same recorded states with only the changed sentence swapped. Comparing two live runs mixes the wording with different seeds, rosters and players; in this project two apparent Director problems turned out to be the scripted test player (findings 29 and 30).
8. [Read a Choice by its confidence (finding 33)](docs/research/jev-findings.md#finding-33). A sampling temperature below one re-reads Jev's second option as weaker than Jev said. Taking `choice` when confident and Jev's distribution as given when not matched the tuned temperatures overall, with no number per question, and let an asked-for hesitation actually change the answer.
9. [Decide the thing, then read its label off it (finding 34)](docs/research/jev-findings.md#finding-34). A door that promised a spell school, decided on its own, repeated whenever Jev's taste was steady (storm on 10 doors of 10). Deciding the cards and badging the door with every school among them kept style fit (67% versus 69%) and widened the schools a run saw from 4.3 to 5.3 of 7.

### Jev versus rule in this game

Measured on 2026-10-07 with the current Director (reward cards judged one at a time, finding 35): the **same 10 seeds**, the expert reference player, briefing state, two players per style, each with a typed sentence (`route-review`'s players). The table measures the share of style-matching **spell cards in Director-generated reward offers**; Jev and rule are the two sources of those offers.

| Style ID | On-style spells offered by Director, Jev / rule |
|---|---:|
| `spam` | 56% / 39% |
| `nuke` | 65% / 48% |
| `area` | 74% / 48% |
| `dot` | 57% / 40% |
| `melee` | 77% / 54% |

Jev-generated offers showed more style-matching **spell** cards in all five styles. Jev showed fewer distinct spells per run (11.9 versus 14.4), so stronger style focus still comes with a narrower spell pool, though less so than before per-card judging (9.7 versus 13.6 in finding 30). Boss reach was Jev 8/10 versus rule 5/10; with ten runs a side this is a lean, not an established survival advantage. The rule arm cannot read the typed sentence at all.

**Player-facing conclusion:** the current data supports “more style-focused spell offers,” but not “more fun” or “more replayable.” No completed human Jev-versus-rule blind-test result is recorded. [011: telemetry and evaluation](docs/planning/011-telemetry-and-evaluation.md) defines the test: players rank which run felt arranged for them and which they would replay.

```sh
pnpm verify          # typecheck, tests, assets, content, audio, spells, and balance harness
pnpm build           # production bundle
pnpm route-review rule 3
```

`pnpm verify` needs no API key or live model call. For the full design, start with [vision and scope](docs/planning/001-vision-and-scope.md), [Jev integration principles](docs/planning/002-jev-integration-principles.md), and [technical architecture](docs/planning/009-technical-architecture.md). The [planning index](docs/planning/README.md) lists the rest; [raster art sources](assets/source/README.md) describes the art pipeline.
