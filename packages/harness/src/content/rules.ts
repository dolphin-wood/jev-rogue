/**
 * The content rules from design doc 010, as pure predicates over any entry
 * shaped like `ContentBase`. `content:check` runs these across every library.
 */
import { isKnownTag, isKnownLabelRef } from "@jr/core";

export interface ContentEntry {
  readonly id: string;
  readonly tags?: readonly string[];
  readonly description: string;
  readonly jev_hints?: { favor_when?: readonly string[]; avoid_when?: readonly string[] };
  readonly resource?: string;
  readonly numeric_ok?: boolean;
}

export interface ContentViolation {
  readonly rule: string;
  readonly library: string;
  readonly id: string;
  readonly detail: string;
}

export const MAX_DESCRIPTION = 220;
const ID_RE = /^[a-z][a-z0-9_]*$/;

export function checkLibrary(library: string, entries: readonly ContentEntry[]): ContentViolation[] {
  const v: ContentViolation[] = [];
  const add = (rule: string, id: string, detail: string) => v.push({ rule, library, id, detail });

  const seen = new Set<string>();
  const resources = new Map<string, number>();

  for (const e of entries) {
    if (!ID_RE.test(e.id)) add("id-format", e.id, "ids are lower snake_case starting with a letter");
    if (seen.has(e.id)) add("id-unique", e.id, "duplicate id within the library");
    seen.add(e.id);

    for (const t of e.tags ?? [])
      if (!isKnownTag(t)) add("tag-vocabulary", e.id, `tag "${t}" is not in the closed vocabulary`);

    if (e.description.trim().length === 0) add("description-present", e.id, "empty description");
    if (e.description.length > MAX_DESCRIPTION)
      add("description-length", e.id, `${e.description.length} characters, limit ${MAX_DESCRIPTION}`);
    if (!e.numeric_ok && /\d/.test(e.description))
      add("description-digits", e.id, "digits need numeric_ok, because the number must be the decision");

    for (const ref of [...(e.jev_hints?.favor_when ?? []), ...(e.jev_hints?.avoid_when ?? [])])
      if (!isKnownLabelRef(ref)) add("hint-label", e.id, `jev_hints references unknown label "${ref}"`);

    if (e.resource) resources.set(e.resource, (resources.get(e.resource) ?? 0) + 1);
  }

  for (const [resource, count] of resources)
    if (count < 2)
      add("resource-singleton", resource, "a resource group of one cannot express exclusivity, so it is a mistake");

  return v;
}

/** Cross-library: ids must be unique across every library, not only within one. */
export function checkGlobalIds(libraries: Readonly<Record<string, readonly ContentEntry[]>>): ContentViolation[] {
  const owner = new Map<string, string>();
  const v: ContentViolation[] = [];
  for (const [library, entries] of Object.entries(libraries))
    for (const e of entries) {
      const prev = owner.get(e.id);
      if (prev) v.push({ rule: "id-unique-global", library, id: e.id, detail: `also defined in ${prev}` });
      else owner.set(e.id, library);
    }
  return v;
}

export function formatViolations(v: readonly ContentViolation[], checked: number): string {
  if (v.length === 0) return `content: OK, ${checked} entries checked`;
  const lines = [`content: FAIL, ${v.length} violations across ${checked} entries`];
  const byRule = new Map<string, ContentViolation[]>();
  for (const x of v) byRule.set(x.rule, [...(byRule.get(x.rule) ?? []), x]);
  for (const [rule, xs] of byRule) {
    lines.push(`  ${rule} (${xs.length})`);
    for (const x of xs.slice(0, 8)) lines.push(`    ${x.library}/${x.id}: ${x.detail}`);
    if (xs.length > 8) lines.push(`    ... and ${xs.length - 8} more`);
  }
  return lines.join("\n");
}
