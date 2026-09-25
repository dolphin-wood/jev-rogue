/** Public surface of the spell pool (design doc 013). */

export {
  BASE_ITEMS, ITEMS, STYLE_START, registryOf, baseOf, plainInstance, num, str,
  type ItemRegistry,
} from "./items.ts";

export * from "./affixes.ts";

export {
  SPELL_SCHOOLS, SCHOOL_OF, SCHOOL_COLOUR, schoolOf, type SpellSchool,
} from "./schools.ts";
