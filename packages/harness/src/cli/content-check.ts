/**
 * Runs the doc 010 content rules across every library, then the build-time
 * resolutions that must succeed before the game ships: the staff table and the
 * affix calibration (doc 006). A failure here is a build failure, not a
 * player's run failing.
 */
import {
  BASE_ITEMS, ENEMIES, FEATURES, SPACE_ARCHETYPES,
  STAFF_TABLE, ALL_PROFILES, resolveAffixTable,
} from "@jr/core";
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

let failed = violations.length > 0;

// Build-time resolutions (doc 006). A profile or affix that cannot be
// resolved must fail the build rather than fail a player's run.
if (STAFF_TABLE.size !== ALL_PROFILES.length) {
  console.log(`staffs: FAIL, ${STAFF_TABLE.size} resolved of ${ALL_PROFILES.length} profiles`);
  failed = true;
} else {
  console.log(`staffs: ${STAFF_TABLE.size} profiles resolved`);
}

const affixes = resolveAffixTable();
const rows = [...affixes.values()];
const degraded = rows.filter((r) => r.status === "dropped").length;
console.log(`affixes: ${rows.length} rows resolved, ${degraded} degraded to none`);

// Broken out per intent, because a whole intent degrading is a balance
// problem the aggregate hides: an intent that never lands is an option Jev
// can pick whose effect is silently nothing (doc 006, doc 007).
const byAffix = new Map<string, { total: number; dropped: number }>();
for (const r of rows) {
  const e = byAffix.get(r.affix) ?? { total: 0, dropped: 0 };
  e.total++;
  if (r.status === "dropped") e.dropped++;
  byAffix.set(r.affix, e);
}
for (const [affix, e] of [...byAffix].sort((a, b) => b[1].dropped / b[1].total - a[1].dropped / a[1].total)) {
  const share = e.dropped / e.total;
  const flag = share > 0.5 ? "  OVER HALF" : "";
  console.log(`  ${affix}: ${e.dropped}/${e.total} degraded (${(share * 100).toFixed(0)}%)${flag}`);
  if (share === 1) {
    console.log(`    ${affix} never lands in band; it must not be offered as an intent`);
    failed = true;
  }
}
if (rows.length === 0) failed = true;

process.exit(failed ? 1 : 0);
