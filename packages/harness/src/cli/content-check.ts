/**
 * Runs the doc 010 content rules across every library. A failure here is a
 * build failure, not a player's run failing.
 */
import { BASE_ITEMS, ENEMIES, FEATURES, SPACE_ARCHETYPES } from "@jr/core";
import { checkLibrary, checkGlobalIds, formatViolations } from "../content/rules.ts";
import type { ContentEntry, ContentViolation } from "../content/rules.ts";

const libraries: Record<string, readonly ContentEntry[]> = {
  items: BASE_ITEMS as readonly ContentEntry[],
  enemies: Object.values(ENEMIES) as readonly ContentEntry[],
};

libraries.features = Object.values(FEATURES) as readonly ContentEntry[];
libraries.archetypes = SPACE_ARCHETYPES.map((a) => ({
  id: a.id, description: a.description, tags: [],
})) as readonly ContentEntry[];

const violations: ContentViolation[] = [
  ...Object.entries(libraries).flatMap(([name, entries]) => checkLibrary(name, entries)),
  ...checkGlobalIds(libraries),
];

const checked = Object.values(libraries).reduce((a, l) => a + l.length, 0);
console.log(formatViolations(violations, checked));
for (const [name, entries] of Object.entries(libraries))
  console.log(`  ${name}: ${entries.length} entries`);

process.exit(violations.length > 0 ? 1 : 0);
