/**
 * Staff generation from a profile under the stat budget (design doc 006,
 * "Starting staff: one question over feasible profiles").
 *
 * The 24 profiles are shapes, not power levels: every one starts at the
 * cheapest point inside its own label bands, and whatever the budget leaves
 * over is spent in a fixed order so generation is deterministic.
 */

import type { Staff, StaffProfile } from "../types.ts";

/* --------------------------------- costs ---------------------------------- */

export const BUDGET = 120;

export const BASELINE = {
  slots: 4,
  mana_max: 60,
  mana_regen: 8,
  cast_interval: 0.2,
  cooldown: 1,
  crit_bonus: 0,
} as const;

export const COST = {
  /** Each slot above four. */
  perSlot: 10,
  /** Per point of mana_max above sixty. */
  perMana: 0.25,
  /** Per point of mana_regen above eight, when bought as a raw stat. */
  perRegen: 4,
  /** Per 0.02 s of cast_interval below 0.20 s. */
  perCastStep: 15,
  castStep: 0.02,
  /** Per 0.1 s of cooldown below 1.0 s. */
  perCooldownStep: 10,
  cooldownStep: 0.1,
  /** The `regen` special: +4 regen, flat price. */
  regenSpecial: 15,
  regenSpecialAmount: 4,
  /** The `crit` special: +10% crit, flat price. */
  critSpecial: 15,
  critSpecialAmount: 0.1,
} as const;

/** Doc 006's label bands. The low end of each is where generation starts. */
export const BANDS = {
  slots: { few: 4, many: 6 },
  mana: { low: [60, 70], high: [110, 120] },
  tempo: { quick: [0.1, 0.12], steady: [0.18, 0.2] },
} as const;

export const COOLDOWN_FLOOR = 0.4;
/** Absolute ceiling on leftover mana spending. */
export const MANA_CEILING = 140;

export const FALLBACK_PROFILE: StaffProfile = {
  slots: "many", mana: "low", tempo: "steady", special: "none",
};

export const ALL_PROFILES: readonly StaffProfile[] = (() => {
  const out: StaffProfile[] = [];
  for (const slots of ["few", "many"] as const)
    for (const mana of ["low", "high"] as const)
      for (const tempo of ["quick", "steady"] as const)
        for (const special of ["none", "regen", "crit"] as const)
          out.push({ slots, mana, tempo, special });
  return out;
})();

export function profileKey(p: StaffProfile): string {
  return `${p.slots}/${p.mana}/${p.tempo}/${p.special}`;
}

/** Rounding guard: every price here is a multiple of 0.25 but float drift in a
 *  long sum can still push a comparison the wrong way. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function staffCost(staff: Staff): number {
  let cost = 0;
  cost += (staff.slots - BASELINE.slots) * COST.perSlot;
  cost += (staff.mana_max - BASELINE.mana_max) * COST.perMana;
  cost += ((BASELINE.cast_interval - staff.cast_interval) / COST.castStep) * COST.perCastStep;
  cost += ((BASELINE.cooldown - staff.cooldown) / COST.cooldownStep) * COST.perCooldownStep;
  if (staff.profile.special === "regen") cost += COST.regenSpecial;
  if (staff.profile.special === "crit") cost += COST.critSpecial;
  // Regen above the baseline that the special did not pay for.
  const freeRegen =
    BASELINE.mana_regen + (staff.profile.special === "regen" ? COST.regenSpecialAmount : 0);
  cost += Math.max(0, staff.mana_regen - freeRegen) * COST.perRegen;
  return round2(cost);
}

export function generateStaff(profile: StaffProfile): Staff {
  const slots = BANDS.slots[profile.slots];
  const manaBand = BANDS.mana[profile.mana];
  const tempoBand = BANDS.tempo[profile.tempo];
  // "The cheapest point inside its own label bands": for mana that is the low
  // end, for cast_interval the slow end, which is what makes doc 006's most
  // expensive profile come out at 107.5 rather than over budget.
  let mana_max: number = manaBand[0];
  const cast_interval: number = tempoBand[1];
  let cooldown: number = BASELINE.cooldown;
  const mana_regen =
    BASELINE.mana_regen + (profile.special === "regen" ? COST.regenSpecialAmount : 0);
  const crit_bonus = profile.special === "crit" ? COST.critSpecialAmount : 0;

  let staff: Staff = { profile, slots, mana_max, mana_regen, cast_interval, cooldown, crit_bonus };
  let spent = staffCost(staff);
  if (spent > BUDGET) {
    throw new Error(`profile ${profileKey(profile)} costs ${spent}, over the ${BUDGET} budget`);
  }

  // Leftovers, in doc 006's order: cooldown to its floor, then mana_max.
  let left = round2(BUDGET - spent);
  while (left >= COST.perCooldownStep && cooldown > COOLDOWN_FLOOR + 1e-9) {
    cooldown = round2(cooldown - COST.cooldownStep);
    left = round2(left - COST.perCooldownStep);
  }
  // The band is what the profile's label *means*, so a "low mana" staff is not
  // pushed to 140 by leftovers it has no other use for; the rest is discarded.
  const manaCap = Math.min(MANA_CEILING, manaBand[1]);
  while (left >= COST.perMana && mana_max < manaCap) {
    mana_max += 1;
    left = round2(left - COST.perMana);
  }

  staff = { profile, slots, mana_max, mana_regen, cast_interval, cooldown, crit_bonus };
  spent = staffCost(staff);
  if (spent > BUDGET) {
    throw new Error(`profile ${profileKey(profile)} resolved to ${spent}, over the ${BUDGET} budget`);
  }
  return staff;
}

/** The table the game ships: all 24 profiles, resolved. */
export const STAFF_TABLE: ReadonlyMap<string, Staff> = new Map(
  ALL_PROFILES.map((p) => [profileKey(p), generateStaff(p)] as const),
);

export function staffFor(profile: StaffProfile): Staff {
  const staff = STAFF_TABLE.get(profileKey(profile));
  if (!staff) throw new Error(`no staff generated for ${profileKey(profile)}`);
  return staff;
}

/** Doc 006's reference `steady` staff, used by calibration and the balance
 *  rules as the fixed point every item is measured in. */
export const REFERENCE_STAFF: Staff = staffFor(FALLBACK_PROFILE);

/** A rest-room slot pick, capped at eight (doc 006, "Staff"). */
export function addSlot(staff: Staff): Staff {
  return { ...staff, slots: Math.min(8, staff.slots + 1) };
}
