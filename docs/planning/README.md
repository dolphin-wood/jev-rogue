# Planning documents

Numbered decision documents for jev-rogue. Each file carries frontmatter with `id`, `title`, `status`, `date`, `summary` and `depends_on`. Statuses: `proposed` → `accepted`. The documents describe one finished game; 012 gives the order in which it is built.

| Id | Title | Summary |
|---|---|---|
| 001 | [Vision and Scope](001-vision-and-scope.md) | Room roguelike of a sword and three keyed spells, with Jev as Director; every Jev decision point; scope and permanent out-of-scope |
| 002 | [Jev Integration Principles](002-jev-integration-principles.md) | Decisions are Jev's, generation is the algorithm's: constraint → decision → generate-and-verify; state, question, sampling, evaluator, failure, RNG and cost conventions |
| 003 | [Run Structure and Game Loop](003-run-structure.md) | Fourteen fights, the merchant room, the boss; the intent screen; portals promising a reward kind and a difficulty; tension from Jev; room state machine, speculative plans, pickups and the gold economy |
| 004 | [Room Generation](004-room-generation.md) | Jev picks space parameters as labels, code generates, measures and retries; round 2 fills zone features and picks the encounter profile |
| 005 | [Encounters and Bullet Patterns](005-encounters-and-bullet-patterns.md) | Movement behaviours, pattern DSL, enemy archetypes with threat weights, encounter profiles assembled to a pressure budget, elite affixes, boss phases, bullet caps |
| 006 | [Spells and Items](006-spells-and-staff.md) | What a spell is and how it casts: the fixed run staff, item kinds, cast loop, elements, damage, the core-owned simulator and best-placement evaluation, base items and balance rules |
| 007 | [Rewards and Build Director](007-rewards-and-build-director.md) | Intent, revealed preference, one offer per room of the door's kind: three blended distributions plus variety, wildcard, pity, temptation, merchant and blacksmith |
| 008 | [Combat Core and Game Feel](008-combat-core-and-feel.md) | Core owns simulation at a fixed step; controls, player stats, collision layers, damage, feel checklist, readability, Jev-chosen room mood derived into a palette, impact and performance targets |
| 009 | [Technical Architecture](009-technical-architecture.md) | Browser-only game plus a stateless proxy (needed for the key and for CORS); packages, schemas, transport, RNG, tests |
| 010 | [Content Ontology and Descriptions](010-content-ontology-and-descriptions.md) | Shared label vocabulary, schema fields, description generator, versioning |
| 011 | [Telemetry and Evaluation](011-telemetry-and-evaluation.md) | Traces, event and commitment logs, replay, three-way blind test against a rule-based control, Director fidelity, balance harness |
| 012 | [Build Order](012-build-order.md) | The steps the game is built in, the built ones marked; Jev exercised end to end from the first step |
| 013 | [Basic Attack, Spells, Enchantments](013-the-melee-turn.md) | Sword basic attack that generates the mana spells cost; three spells on three keys with three affixes each, duplicate spells and affixes upgrade what is held; spell level from the blacksmith and elite doors, affix tier from drops; a replaced spell drops on the floor to pick up again or dismantle; rewards split into stat, spell, affix and gold |
| 014 | [Run Length](014-run-length.md) | About twenty minutes: fourteen combat rooms at 30 to 40 seconds, the 3 s / 30–40 s / 60–80 s pacing loops, a low-threat beat after every peak, one offer per room against three spell slots |
| 015 | [Room Geometry for Melee](015-room-geometry-for-melee.md) | Melee arenas stay largely open, because ranged threats carry the geometry and obstacles hinder the player more than the enemies; width profile, footholds, convex corners, times-to-contact, and the generator metrics that measure them |

Adding a document: take the next number, fill the frontmatter, add a row here.
