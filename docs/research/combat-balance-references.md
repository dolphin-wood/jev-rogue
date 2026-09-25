# Damage balance in action roguelikes — a reference survey

Research notes gathered while the sword/spell numbers were being retuned.
External sources only; the last section is the only part that talks about this
repository. Every figure is from a published source unless it is marked
**[inferred]**, which means it is arithmetic done here on published inputs, or
a judgement. Sourcing strength is uneven and is stated at the end.

Our own constants, for reading against: sword 9 damage a swing at ~0.27 s
(~3.7 swings/s, ~30 DPS); mana pool 90, base cast 5, regen 2%/s (1.8/s),
on-hit refund 9% of max (8.1/hit); spell level +20% damage for +10% mana to
level 5; 3 affix slots, largest affixes 1.5–1.7x and multiplicative; enemy HP
by room tier x1 / 1.2 / 1.45 / 1.7, elites x2.

---

## 1. Primary attack vs abilities

**Hades (2020) sets the ability at about 2.5x the primary's per-hit, and lets
the primary win on sustained damage.** Stygian Blade: Strike 20, combo
20 → 25 → 30, Dash-Strike 30, Nova Smash (Special) 50. Cast is 50 base damage
and is innate to the character, not to the weapon.
https://hades.fandom.com/wiki/Stygian_Blade ·
https://hades.fandom.com/wiki/Cast
So the Special and the Cast are each 2.5x the opening attack hit, and 0.48x
the full three-hit combo (75). **[inferred]** Because a combo lands in roughly
the time one Cast does, the attack is the higher sustained DPS at base; the
Cast only pulls ahead once boons raise it.

**Hades II runs the same idea with a mana pool and a much steeper ratio.**
Witch's Staff: Attack combo 20 → 25 → 60 (105 total), Dash-Strike 30, Special
40; Ω Attack 160 for 20 Magick; Ω Special 80 for 10 Magick. Sister Blades:
Attack combo 20 → 20 → 10x5 → 80 (170), Dash-Strike 45, Ω Attack 100 for 10
Magick. Base Magick pool is 50.
https://hades.fandom.com/wiki/Witch%27s_Staff ·
https://hades.fandom.com/wiki/Sister_Blades ·
https://hades.fandom.com/wiki/Magick
So the staff's Ω Attack is 8x the opening attack hit and 1.5x the whole combo,
for 40% of the pool. Damage per Magick is 8 on the staff (both Ω moves) and 10
on the Sister Blades — Supergiant appears to price an Ω move by damage-per-
resource and then choose the hit size **[inferred]**. Note the wiki's own
framing of the staff: "the basic Attack and basic Special are functional but
have a rather low damage output, while the Ω Special and particularly the Ω
Attack are quite the opposite" — that weapon is deliberately the
mana-dependent one, and the Sister Blades are deliberately the weapon that
works in a "low Magick build".

**Wizard of Legend makes basics the sustain and signatures pure burst.**
Bouncing Blaze (Basic, fire): 12 damage, 3 hits per combo, cooldown 0. Glacial
Cross (Signature, ice): 50 damage, 6.5 s cooldown.
https://wizardoflegend.fandom.com/wiki/Bouncing_Blaze ·
https://wizardoflegend.fandom.com/wiki/Glacial_Cross
Per hit the signature is 4.2x the basic; amortised over its cooldown it is
50/6.5 ≈ 7.7 DPS against a basic that fires several times a second
**[inferred]**. Basics are lower damage but have no cooldown and are the
fallback when everything else is down — the Wizard of Legend 2 wiki describes
them as "fast, fairly low damage Arcana".
https://wizardoflegend2.wiki.gg/wiki/Arcana/Basics

**Risk of Rain 2 publishes the ratio directly, because every skill is a
percentage of one base damage number.** Survivors have 12 base damage at level
1 (+2.4 per level). Commando's primary Double Tap is 100% damage (12);
his secondary Phase Round is 300% (36), and pierces. Artificer's charged
skills are 400–1200% (Nano-Spear) and 400–2000% (Nano-Bomb).
https://riskofrain2.wiki.gg/wiki/Damage
So: secondary ≈ 3x the primary per hit; charged specials 4–20x.

**Enter the Gungeon has no cooldown abilities at all; the whole spread lives
in the gun pool.** Rusty Sidearm (a starting gun): 6 damage, 0.20 s fire rate
manual, magazine 6, reload 1.2 s, **16.4 DPS**.
https://enterthegungeon.wiki.gg/wiki/Rusty_Sidearm
Golden Gun sits at 80 DPS, roughly 4.9x the starter **[inferred]**. Actives
and blanks are charge/consumable, not a DPS line.

**Dead Cells has no fixed primary either** — every weapon publishes its own
computed DPS in the inventory and skills sit on cooldowns. Relevant number
instead: each weapon level is +10% damage, and each scroll in a matching
colour is +15%, so damage ≈ base x 1.15^(stats−1), which the wiki summarises
as "DPS is doubled with every +5 stats".
https://deadcells.wiki.gg/wiki/Stats

**Soul Knight is the closest structural match to our sword/spell split, and it
inverts the resource.** Melee weapons cost zero Energy and are the highest
damage, guaranteed-hit option, paid for by having to close distance; ranged
weapons consume Energy per shot, and "a weapon with high damage and high
energy requirement is only useful if the player has sufficient energy".
https://soul-knight.fandom.com/wiki/Game_Mechanics

**Children of Morta publishes no numbers.** The wikis and guides are
qualitative only ("John's Primary Attack damage is below average", "Heaven's
Strike has a very high cooldown"). Nothing usable here.
https://childrenofmorta.fandom.com/wiki/John

**The band.** Per-hit, primary : cooldown/resource ability runs about
**1 : 2.5–8** (Hades 2.5, RoR2 3, Wizard of Legend 4.2, Hades II 8). Sustained
DPS is far closer to 1 : 1, or favours the primary outright, because the
ability is rate-limited. Almost nobody makes the resource ability out-sustain
the free attack at base; the ability wins on burst and on how well it scales.

---

## 2. Resource economy

**Hades gates the Cast on ammo with a slow, fixed refill.** One reusable
Bloodstone that regenerates in 3 s (Stygian Soul), or three that must be
physically picked up off the floor (Infernal Soul); Mirror ranks make the
regenerating one 1 s faster per rank.
https://hades.fandom.com/wiki/Cast
The refill rate is not under the player's moment-to-moment control, which is
the point.

**Hades II gates Ω moves on Magick, with no baseline per-second regen at
all.** Melinoë starts each encounter with a full 50 Magick, and every source
of regeneration is a boon, keepsake or item. Two are worth copying:

- **On-hit restore is a boon, not a baseline.** "Whenever your Attack or
  Special deal damage, restore Magick: 4 / 6 / 8 / 10" by rarity
  (Common → Heroic). On a 50 pool that is 8–20% per strike, and only from
  weapon hits.
- **Regen is suspended while you are spending.** "Any per-second regeneration
  boosts do not function while Melinoë is actively charging or firing an
  ability that consumes it."

https://hades.fandom.com/wiki/Magick

**Soul Knight's Energy is ammo with no passive regen** — it comes back from
the Statue of the Priest, skills, potions and the Energy Stone. Melee costs
nothing, which is what makes melee the sustain option when Energy runs dry.
https://soul-knight.fandom.com/wiki/Game_Mechanics

**Gungeon uses per-gun ammo plus a consumable (blanks), and caps the payoff at
the other end** — see the boss DPS cap in §3.

**Risk of Rain 2 and Wizard of Legend use cooldowns only**; the primary is
free and always available.

**The pattern: one limiter per option.** Hades = ammo. Hades II = mana.
RoR2 / Wizard of Legend = cooldown. Soul Knight = energy. Where two limiters
exist on the same ability, one of them is slack, and it is worth deciding
on purpose which one binds.

---

## 3. Multi-hit, chains and on-hit effects

**Risk of Rain 2's proc coefficient is the canonical solution and it is worth
copying wholesale.** Every hit carries a scalar that multiplies an on-hit
item's trigger chance *and* its effect duration. Published values: Commando
Double Tap 1.0; Huntress Flurry 0.7 (x3 arrows); MUL-T Auto-Nailgun 0.6;
Engineer turret 0.6; Railgunner Supercharged Railgun 3.0. The design rule the
wiki states: "If something hits very frequently, it may have a lower proc
coefficient... Conversely, an infrequent, hard-hitting ability may have a
higher proc coefficient."
https://riskofrain2.wiki.gg/wiki/Proc_Coefficient
The effect is concrete: MUL-T's Nailgun at 0.6 needs 17 Tri-Tip Dagger stacks
for guaranteed bleed; Railgunner at 3.0 needs 4, and the resulting bleed lasts
1.8 s vs 9 s.

**Two hard rules fall out of that page.** Damage-over-time effects (Bleed,
Burn, Collapse) have a coefficient of **0.0** and never trigger item effects
at all — that is what stops DoT-feeds-DoT loops. And skills' proc coefficients
cannot be modified by items, so no build can inflate them.

**Chained pieces are discounted twice — on damage and on proc weight.**
Ukulele: 25% chance on hit to chain to 3 (+2 per stack) targets within 20 m,
"dealing 80% total damage to each with a proc coefficient of 0.2". So the
chained hit is 0.8x damage and carries only 0.2x proc weight — a 5% Sticky
Bomb becomes 1% on the chain, a 10% AtG Missile becomes 2%.
https://riskofrain2.wiki.gg/wiki/Ukulele

**Path of Exile charges for extra projectiles with a "less" multiplier.**
Greater Multiple Projectiles Support: "+4 additional Projectiles,
(26–35)% less Projectile Damage". Awakened GMP: +5 projectiles, (21–25)% less.
https://pathofexile.fandom.com/wiki/Greater_Multiple_Projectiles_Support
The same page documents the known degenerate case, and it is exactly the one
our affix list invites: the "less projectile damage" modifier **does not apply
to Poison**, so a multi-projectile skill that poisons gets the extra hits for
free. If our `blight` (poison) rolls off hit count without paying the
per-piece discount, scatter+blight is the runaway build.

**Enter the Gungeon puts a hard ceiling on the other end.** Every boss has a
DPS cap measured across a 3-second window; a single shot is capped at triple
the floor's cap. Per-floor caps (post-*A Farewell to Arms*): Keep 30,
Gungeon Proper 42, Black Powder Mine 60, Hollow 70, Forge 78, Bullet Hell 80.
Explicitly exempt: Glass Cannon, Makeshift Cannon, Yari Launcher, and any
weapon dealing ≥1000 damage in one projectile.
https://enterthegungeon.fandom.com/wiki/Bosses
**[inferred]** Note the shape of that curve: floor 1's cap is 1.8x the starter
gun's 16.4 DPS and the last floor's is 4.9x — the whole sanctioned growth in
boss-killing power across a full run is about **2.7x**.

---

## 4. DoT vs direct hit

**Hades caps every status curse's stacks and keeps durations short.** From the
status table: Hangover max 5 stacks, ticks every 0.5 s over 4 s; Chill max 10
stacks, 4% slow each, 8 s; Doom max **1**, a single burst 1.1 s after
application; Weak, Marked, Jolted, Exposed all max 1.
https://hades.fandom.com/wiki/Status_effects
Hangover damage: 4 per stack from Drunken Strike (+1 per rarity), 15 from
Dionysus' Aid (+1.5 per rarity), and stacks wear off one at a time after 4 s —
a refresh-per-stack model, not a single refreshing timer.

**Hades pays you for breadth instead of depth.** The Mirror's *Privileged
Status*: an enemy carrying 2 or more **different** status curses is "Punished"
and takes additional damage. That is the published answer to the
element-on-element dead card: a second fire spell adds nothing, a fire + ice
pair adds a multiplier.

**Wizard of Legend makes the dead card merely worse, not dead.** "Elemental
attacks deal −20% damage to targets of the same elemental type, +20% damage to
targets that are weak to that element, and −10% damage to targets that are
strong to that element," and elemental enemies resist their own element.
https://wizardoflegend.fandom.com/wiki/Arcana

**Path of Exile splits its ailments into stacking and non-stacking.** Poison
is cumulative with no stack limit, but "a single hit can apply a maximum of
one poison stack, therefore having more than 100% chance to poison is
redundant." Ignite does not stack by default — only the strongest applies —
unless an item explicitly grants additional ignites. There is no limit on the
number of *different* ailments a target can carry.
https://pathofexile.fandom.com/wiki/Poison ·
https://pathofexile.fandom.com/wiki/Ignite ·
https://pathofexile.fandom.com/wiki/Ailment
Damaging ailments in PoE snapshot the applying hit's modifiers, so a DoT
applied before a buff does not retroactively scale.

**Risk of Rain 2 prices DoT as a fraction of base damage per tick, and ties
its duration to the hit that applied it.** Bleed: 20% base damage per tick, 4
ticks/s, duration = 3 x proc coefficient seconds. Ignite: 10% base damage per
tick, duration "proportional to the strength of the inflicting hit".
https://riskofrain2.wiki.gg/wiki/Damage
So a weak, fast hit applies a short DoT and a slow, heavy hit applies a long
one, without anyone hand-tuning per weapon.

---

## 5. Stacking multipliers

**Hades is almost entirely additive, and says so through its Cast design.**
Percentage upgrades "stack additively based on the base damage of the
abilities which they affect", which is why Cast boons — which raise *base*
damage rather than giving a percentage — "synergize much more effectively with
cast boons than they do with Zagreus' attack or special boons." Common →
Heroic cast damage by boon, against an unmodified Cast of 50: Electric Shot
(Zeus) 60 → 90, Flood Shot (Poseidon) 60 → 96, True Shot (Artemis) 70 → 100,
Crush Shot (Aphrodite) 90 → 120, Phalanx Shot (Athena) 85 → 136.
https://hades.fandom.com/wiki/Cast
The take-away is a design one: if your percentage modifiers are additive, the
way to create a late-run spike is a flat base-damage jump, not another
percentage.

**The Binding of Isaac puts ordinary damage ups under a square root and keeps
a small multiplicative bucket.**
`EffectiveDamage = (CharBaseDmg × √(TotalDmgUps × 1.2 + 1) + FlatDmgUps) × Multipliers`
One Pentagram takes Isaac from 3.5 to 5.19 (+1.69); a second takes him to 6.45
(+1.26). Multiplicative items are few and large: Sacred Heart x2.3, Eve's
Mascara x2.0, Cricket's Head x1.5, Magic Mushroom x1.5. Flat items that apply
after the formula (Curved Horn +2) are best precisely when damage is already
high.
https://bindingofisaacrebirth.wiki.gg/wiki/Damage

**Risk of Rain 2 uses three explicit stacking shapes and picks by what the
stat can break.** Linear where nothing breaks (Soldier's Syringe +0.15 attack
speed per stack). **Hyperbolic** for anything that would otherwise reach 100%:
Tougher Times is 15% per stack under `1 − 1/(1 + 0.15n)`, giving 13.0% at one
stack, 23.1% at two, and asymptotic to but never reaching 100%. **Exponential**
only on an item with a brutal drawback: Shaped Glass at `+(2^x − 1)`.
https://riskofrain2.wiki.gg/wiki/Item_Stacking ·
https://riskofrain2.wiki.gg/wiki/Damage

**Path of Exile's two-bucket rule is the cleanest statement of the idea**, and
the wiki states it plainly: "you add the various 'increased'/'reduced' effects
together into a single multiplier, and multiply the base stat by the result,
whereas you multiply the base stat by each 'more'/'less' effect in turn." Flat
added stats come first; the documented application order is local additive and
multiplicative, then global/skill additive, then global/skill multiplicative.
The wiki's own tip: "Assuming equal values, 'more' is usually far more
powerful than increased."
https://pathofexile.fandom.com/wiki/Stat#Flat,_additive_and_multiplicative_stats
**[inferred]** Worked through: 100 base with +100% and +50% increased is 250,
not 300; a 43% "more" on top of a 300% additive total gives 429%.

**Diablo 3 is the same shape**: every buff is additive with others in its own
category, and the categories multiply.
https://maxroll.gg/d3/resources/damage-multipliers-thorns-explained

**How the late-run explosion is made safe.** The common recipe is: the bulk of
acquirable power goes in one additive bucket (so the tenth pickup is worth
less than the first in relative terms); a small, rare set of true multipliers
provides the spike; and anything approaching a hard ceiling gets a concave
function (√ in Isaac, hyperbolic in RoR2). Unbounded multiplicative stacking
appears only in PoE and RoR2 — and both pair it with unbounded enemy scaling
to absorb it.

---

## 6. Enemy HP scaling and time-to-kill

**Dead Cells has a published TTK rule: "two-second combat".** Encounters were
tuned so a fight resolves in about two seconds, because players face dozens of
enemies per level; high-risk weapons were made to kill faster than standard
ones.
https://www.gamedeveloper.com/business/tuning-i-dead-cells-i-to-appeal-to-players-both-fast-and-slow

**Hades' trash HP climbs about 2.5x per biome while the weapon's base numbers
never move.** Tartarus: Numbskull 30, Wretched Thug 160, Wretched Lout 210.
Asphodel: Skull-Crusher 420 (500 armoured). Elysium: Soul Catcher 1100 (2000
armoured).
https://hades.fandom.com/wiki/Numbskull ·
https://hades.fandom.com/wiki/Wretched_Thug ·
https://hades.fandom.com/wiki/Wretched_Lout ·
https://hades.fandom.com/wiki/Skull-Crusher ·
https://hades.fandom.com/wiki/Soul_Catcher
**[inferred]** Against a Stygian Strike of 20 that is 2 hits, 8 hits and 11
hits in Tartarus, and roughly 21–55 hits by Elysium if you never took a boon.
Total trash HP growth across the run is about **6–7x**; the entire gap is
closed by boons, hammers and Poms.

**Risk of Rain 2 publishes the scaling formula.**
`coeff = (playerFactor + minutes × timeFactor) × stageFactor`, with
`playerFactor = 1 + 0.3 × (players − 1)`,
`timeFactor = 0.0506 × difficultyValue × players^0.2`,
`stageFactor = 1.15^stagesCompleted`, and
`enemyLevel = 1 + (coeff − playerFactor) / 0.33`. Each level is **+30% health
and +20% damage**.
https://riskofrain2.wiki.gg/wiki/Difficulty
Base trash: Lemurian and Beetle 80 HP (+24/level), Lesser Wisp 35 HP
(+10/level), Greater Wisp 750 (+225/level).
https://riskofrain2.wiki.gg/wiki/Lemurian ·
https://riskofrain2.wiki.gg/wiki/Lesser_Wisp
**[inferred]** At level 1, against Commando's 12-damage primary: Lesser Wisp
3 hits, Lemurian/Beetle 7 hits.

**The observed band.** Trash dies to roughly **2–8 primary hits**; the HP step
between tiers is 1.2–1.5x and between zones 2–2.5x; total trash HP growth
across a full run is 6–7x (Hades) or unbounded-but-tracking-the-clock (RoR2).
Gungeon caps TTK from the *fast* side instead, via the boss DPS cap.

---

## 7. Measurement practice

**Normalise every ability to one unit.** RoR2's entire skill catalogue is
expressed as a percentage of a single base damage number plus a proc
coefficient, so any skill is a two-number spec on one bench and changing base
damage moves everything coherently.
https://riskofrain2.wiki.gg/wiki/Damage

**Bench sustained damage, not burst.** The formula behind Gungeon's wiki DPS
column (community-derived on the talk page, not an official figure):
`(magazine size × damage) / ((magazine size − 1) × fire rate + reload time)`
— reload is in the denominator, so a big magazine does not flatter a gun; the
magazine size is reduced by one because reload begins the instant the magazine
empties; and where reload time is *lower* than the fire rate, the fire rate is
substituted for it.
https://enterthegungeon.fandom.com/wiki/Talk:Guns

**Show the player the same number the designer uses.** Dead Cells computes DPS
in the inventory *including* stat bonuses, "so what's displayed is the actual
damage output you'll deal".
https://deadcells.wiki.gg/wiki/Stats

**Hold an explicit TTK target, not only a DPS target.** Dead Cells' two-second
rule is the clearest published example; Hades and Hades II publish per-move
damage tables and the exact auto-fire combo sequence rather than a DPS figure,
which amounts to specifying TTK in hits.
https://hades.fandom.com/wiki/Witch%27s_Staff

**Pair metrics with feedback.** Mega Crit's GDC 2019 talk on Slay the Spire
describes a metric-driven focus from early development and heavy data-driven
iteration through Early Access, combined with community feedback on balance.
https://www.gamedeveloper.com/design/learn-i-slay-the-spire-i-s-metrics-driven-approach-to-game-balancing-at-gdc-2019
Motion Twin's Dead Cells post-mortems are the counterweight: the pacing
problems were found by players in Early Access, not in a spreadsheet.
https://www.gdcvault.com/play/1025788/-Dead-Cells-What-the

---

## What this means for jev-rogue

1. **Keep base spell damage per cast at 2.7–3.7 swings (24–33 damage) and do
   not chase Hades II's 8x.** At 30 sword DPS and ~1 cast/s, a 0.75–1.0x DPS
   target is exactly 24–33 per cast **[inferred]**. That sits at the low end
   of the observed per-hit band (Hades 2.5x, RoR2 3x, Wizard of Legend 4.2x)
   and is the right end: Hades II's 8x buys a weapon whose basic attack is
   deliberately weak, whereas our sword is meant to be the high-risk,
   high-reward option. `SPELL_DAMAGE_SCALE = 3.6` is doing the right job;
   verify the landing with `spell-bench`, not by editing per-spell numbers.

2. **Cut `MANA_PER_HIT_FRACTION`; it is the number that contradicts common
   practice hardest.** 9% of 90 is 8.1 mana per hit, and at 3.7 swings/s the
   sword alone returns ~30 mana/s against a base cast of 5 — about six casts'
   worth per second of melee uptime, before the 1.8/s regen **[inferred]**.
   No shipped comparable gives on-hit resource return of that size for free:
   Hades II's equivalent is 4–10 Magick on a 50 pool (8–20%) and it is a
   **boon**, obtained at Common-to-Heroic rarity, and it only fires on Attack
   and Special. Take it to 3–4% (2.7–3.6 mana, so roughly two sword hits fund
   one base cast), or cap the refund per second, or move it out of the
   baseline and make it a reward item. Otherwise mana never binds and the
   per-spell cooldowns are the only real limiter — which is the failure
   `spells.ts` already names in its own comment.

3. **Also copy Hades II's rule that regen is suspended while you are
   spending.** "Per-second regeneration boosts do not function while Melinoë
   is actively charging or firing an ability that consumes it." One line, and
   it removes the case where regen and casting stack into free uptime.

4. **Split the affixes into buckets; three multiplicative 1.5–1.7x slots is
   more aggressive than anything except PoE and RoR2.** Three slots at
   1.5–1.7 is x3.4–4.9, and level 5 adds x1.8, for a ceiling around
   **x6–8.8 over base** **[inferred]**. PoE and RoR2 allow that shape only
   because enemy scaling is unbounded; Hades, Isaac, Gungeon and Dead Cells
   all put the bulk of acquirable power in one additive bucket. Concretely:
   make affixes of the same class additive with each other (PoE "increased",
   Diablo 3 buckets) and reserve at most one genuine multiplier per build
   (PoE "more", Isaac's Sacred Heart x2.3). A x3–4 end-of-run spell "clearly
   exceeds the sword" — the user's stated goal — without breaking the HP
   ramp.

5. **Give every hit a proc weight and cost multi-hit pieces twice.** Add an
   RoR2-style proc coefficient to each shot, and apply it to kindle, blight,
   rime, brand and harvest so those affixes do not fire once per pellet, per
   chain jump or per orbit tick. Published anchors: a chained hit is 0.8x
   damage and **0.2x** proc weight (Ukulele); +4 projectiles costs 26–35%
   *less* damage (GMP); a fast 3-round burst runs 0.7 per arrow (Huntress
   Flurry); a rapid-fire weapon 0.6 (MUL-T Nailgun). Give a hard-hitting slow
   spell above 1.0 (Railgunner is 3.0) so the slow-nuke spells have a reason
   to exist.

6. **Set DoT tick proc weight to 0.0 and cap blight stacks at about 5.** RoR2
   gives Bleed, Burn and Collapse a coefficient of 0.0 and they never trigger
   items — that is the one rule that stops a DoT-feeds-DoT loop. Hades caps
   Hangover at 5 stacks over 4 s (refreshing one stack at a time), Chill at 10
   over 8 s, and Doom at 1. Snapshot the caster's power when the DoT is
   applied (PoE ailments), so a stack laid down before a buff does not
   retroactively scale. Watch specifically for PoE's published degenerate
   case: their projectile "less" multiplier does **not** apply to Poison, so
   scatter + blight is the build most likely to run away in our pool.

7. **Fix the element-on-element dead card with a soft penalty plus a breadth
   bonus, not a no-op.** Wizard of Legend: same element −20%, weak +20%,
   strong −10%. Hades' *Privileged Status*: extra damage when a target carries
   2 or more **different** curses. Together those make a second fire spell
   playable but clearly worse than fire + ice, which is the behaviour we want
   out of the Jev director's reward choices.

8. **The enemy HP ramp is too flat for the build curve.** x1 → 1.7 over 15–20
   rooms (x3.4 on elites) against build growth of x6–9 means the back half of
   a run trivialises. Hades grows trash HP ~6–7x across a run; RoR2 adds +30%
   HP per level on top of a 1.15^stage floor factor. Either take the ramp to
   ~x3–4 by the final room — 1.08 per room over 18 rooms gets there — or
   flatten build growth per recommendation 4. Elite x2 is in line with
   practice and can stay.

9. **Tighten "room-1 enemies take 2–5 starter casts" to 2–3.** Five casts at
   ~1 cast/s is ~5 s on a first-room trash mob, against Dead Cells' explicit
   two-second rule and RoR2's 3–7 primary hits for level-1 trash. At 24–33
   damage a cast that means room-1 HP of about **50–100**, or 6–11 sword
   swings **[inferred]**. Keep the long TTKs for elites (10–20 casts) where
   the pressure is the point.

10. **Give the boss a Gungeon-style DPS cap over a rolling 3-second window.**
    That is the published mechanism for letting a stacked chain/scatter build
    feel enormous on trash without deleting the boss, and it keeps the boss
    fight's authored phases intact. Gungeon's caps run 30 on floor 1 to 80 in
    Bullet Hell — about 1.8x to 4.9x its starter gun's 16.4 DPS, i.e. ~2.7x of
    sanctioned growth across a run **[inferred]**. For us that would be a cap
    near 2–3x the sword's 30 DPS, with the single-hit cap at 3x the per-second
    cap, as Gungeon does.

11. **Add TTK to the bench output, not just DPS.** `spell-bench` already
    reports every spell as a fraction of the sword on pinned dummies, which is
    the RoR2 normalisation done right. What is missing is the Dead Cells side:
    swings-and-casts-to-kill per enemy tier per room index, so a pacing
    regression (a 5-second trash mob) shows up as a number rather than only in
    playtest. Bench sustained damage the way Gungeon's formula does — include
    cooldown and mana-starve time in the denominator, not just cast time.

### Where our current design contradicts common practice

- **The free 9%-of-max on-hit mana refund.** Nothing surveyed gives a
  resource return that large as a baseline; the nearest analogue is a
  Hades II boon.
- **Two limiters on the same ability.** Every comparable gates its powerful
  option on exactly one of {ammo, mana, cooldown}. We have mana *and*
  per-spell cooldowns, so one is always slack — today it is mana. The design
  doc should state which one is meant to bind.
- **Three stacked multiplicative affixes against a x1.7 HP ramp.** The
  multiplier shape belongs to games with unbounded enemy scaling.
- **A 5-cast room-1 trash mob.** Out of band with every published TTK target.

### Sourcing strength

Strongest: Risk of Rain 2 (the wiki is datamined and publishes formulas
verbatim), Path of Exile, Isaac, Enter the Gungeon, Hades and Hades II (per-
move damage tables are authoritative). Medium: Dead Cells (formulas are
community-derived from in-game readouts), Wizard of Legend (individual arcana
pages are reliable; there is no published cross-tier ratio, so the 4.2x is
two data points). Weak or absent: Children of Morta publishes no numbers at
all; the Slay the Spire and Dead Cells GDC references are announcements and
write-ups rather than transcripts, so the methodology claims in §7 are thinner
than the numbers elsewhere.
