# Spell Roster Survey: Per-Archetype Ability Design in Shipped Games

Research for the spell-roster redesign (sword basic attack earns mana; three self-contained spells on U/I/O; up to 3 affixes; level 1-5;
five play styles: Barrage, Heavy, Crowd, Affliction, Blade).

**How to read this doc.** Every claim carries a source. Tags:

- **[pub]** means a number or rule that appears in the game's own text, a patch note or a data-mined wiki table.
- **[comm]** means community consensus (tier lists, guides, forum threads). It is opinion, not data.
- **[inf]** means my own inference or synthesis. Nobody published it.
- **[recall]** means it comes from my knowledge of the game and I could not re-verify it on a fetched page this session. Many wikis
  (Fandom, poewiki.net, lastepochtools) blocked fetching, so these items are marked rather than dropped.

Engine shapes referenced below: `bolt` (seek/curve/chain/pierce/count/spread), `orbit`, `field`, `pillar`, `dash`, `vortex`,
`summon`, `eruption` (line or scatter). **NEW** marks a behaviour the engine does not have yet.

---

## 0. Structural patterns worth copying (summary)

| Game | How abilities are grouped | What the grouping buys |
|---|---|---|
| Hades | 9 gods x 12-14 boons each. A god = one status effect plus a slot-boon for each of Attack/Special/Cast/Dash/Call, then passives gated by prerequisites. At most 4 Olympians per run. | Each god reads as a playstyle because *the same slot* (e.g. Cast) behaves differently per god. |
| Hades II | 9 gods x 13-14 core boons + 1 infusion + 1 legendary; 37 duos. Omega (hold-to-charge, spends Magick) versions of each move; Selene Hexes charge by spending Magick. | Resource spending is itself an archetype (Magick-dump builds). |
| Wizard of Legend | Arcana are typed by slot (Basic / Dash / Standard / Signature) x element x tag (Melee / Projectile / Summon). | The *slot* fixes cadence (no cooldown / evade / cooldown / meter). The element fixes the status. |
| Diablo 4 (Sorcerer) | Skills are in role clusters: Basic, Core, Defensive, Conjuration, Mastery, Ultimate. You may equip only one Ultimate. | The cluster fixes the resource rule: Basic builds mana, Core spends it, Conjuration runs on its own, Ultimate has a long cooldown. |
| Soulstone Survivors | Each skill has 1-2 Primary tags (element or verb: Slam, Swing, Thrust, Chain...), 1-3 Shape tags (Area, Burst, Frontal, Lasting, Missile, Static) and a Magical/Physical tag. Upgrades target tags by rarity. | Shape tags are exactly "delivery". Upgrades can target a delivery instead of a single skill. |
| Vampire Survivors | Weapons are identified by delivery (nearest-target, facing, orbit, aura, zone, random strike, bounce, fixed directions). Each weapon's text names which global stats it *ignores*. 6 weapon slots. | "Ignores Speed/Duration" is a cheap, honest way to say what a weapon is *not* for. |

Sources: Hades boon counts [pub] https://hades.wiki.fextralife.com/Boons ; Hades II per-god counts [pub]
https://hades2.wiki.fextralife.com/Boons ; WoL types [pub] https://maxroll.gg/wizard-of-legend-2/guides/wizard-of-legend-2-arcana-guide ;
D4 clusters [pub] https://maxroll.gg/d4/resources/sorcerer-class-overview ; Soulstone tags [pub]
https://www.chaptercheats.com/cheat/pc/566344/soulstone-survivors/hint/177605 ; VS weapon table [pub] https://vampire.survivors.wiki/w/Weapons

**[inf] Takeaway for jev-rogue.** The games that make archetypes feel different key them to *cadence and delivery*, not damage type.
Hades uses the verb slot, WoL the arcana slot, and D4 the resource rule. Colour and status come second. This fits our five styles:
Barrage is a cadence, Heavy a commitment, Crowd a geometry, Affliction a time profile, and Blade a range band.

---

## 1. Archetypal mechanics per style

Format: **Mechanic.** How the player uses it. *Source.* Our engine mapping.

### 1.1 Barrage / spam (many cheap fast casts, chain and fan out)

1. **Charge bank dump.** The spell stores charges while idle (WoL Dragon Arc holds up to 8), and one cast releases all of them as
   piercing dragons. The player chooses between tapping often and saving up a volley. *WoL Dragon Arc [pub],
   https://wizardoflegend.fandom.com/wiki/Dragon_Arc (via search excerpt).* Maps to `bolt` + count. **NEW**: a charge store.
2. **Fan / shuriken spread.** A fixed arc of 5 daggers that freezes on hit. The enhanced version throws 3 volleys in a row and slides
   you backwards, which is recoil as a movement cost. *WoL Frost Fan: 5 x 25 dmg, 5 s freeze [pub],
   https://wizardoflegend.fandom.com/wiki/Frost_Fan (via search excerpt).* Maps to `bolt` + spread. Recoil is **NEW**.
3. **Auto-target nearest, no aim.** Fires at the nearest enemy, so the player's only job is positioning. *VS Magic Wand [pub].* Maps
   to `bolt` + seek.
4. **Facing-direction stream.** Rapid shots in the direction you face, so aim comes from movement. For a keyboard-only game this is the
   natural "aim". *VS Knife [pub].*
5. **Fixed four-way spray.** Shoots in 4 fixed directions and rewards rotating your position relative to the pack. *VS Phiera Der
   Tuphello / Eight the Sparrow [pub].* Maps to `bolt` + count, with a fixed angle set.
6. **Ricochet / bouncing.** The shot bounces around the room and passes through enemies, so wall geometry matters.
   *VS Runetracer [pub]; RL2 Magic 8 Ball gains damage per bounce [pub], https://roguelegacy.wiki.gg/wiki/Rogue_Legacy_2_spells.*
   **NEW**: wall bounce.
7. **Return boomerang that pulls.** A long-range, quick-cooldown shot that returns and drags enemies toward you. *WoL Cyclone
   Boomerang [comm], https://steamcommunity.com/app/445980/discussions/0/1760230437369878270/.* Maps to `bolt` + return (**NEW**) +
   pull.
8. **Chain between foes.** One hit jumps between nearby targets, which rewards casting into clumps. *Hades Zeus Electric Shot
   (60 dmg, bounces) [pub], https://hades.wiki.fextralife.com/Boons; D4 Chain Lightning (chains up to 5 times) [pub],
   https://maxroll.gg/d4/build-guides/chain-lightning-sorcerer-guide.* Maps to `bolt` + chain.
9. **Threshold proc ("every N damage").** A foe with Blitz takes a lightning strike each time it has taken 120 damage, and then the
   counter resets. Fast weapons trigger it constantly and slow ones rarely, so *cadence itself* is rewarded. *Hades II Zeus Blitz [pub],
   https://rogueranker.com/zeus-hades-2/.* **NEW**: a per-enemy damage counter. A strong candidate Barrage affix.
10. **Chance to fire twice.** Every bolt has an X% chance to repeat. *Hades II Double Strike (+10-25%) [pub].* This is our existing
    `repeat` affix. (Community view: weak at low rarity, see section 4.)
11. **Homing multi-hit swarm.** 6-12 homing swords per cast. *Astral Ascent Virgo "Light Swords" (3 mana) [pub],
    https://astralascent.wiki.gg/wiki/Spells.*
12. **Wandering orb.** A slow ball that zaps whatever is near it, so the player lays down several and moves on. *D4 Ball Lightning
    [pub], https://www.icy-veins.com/d4/guides/ball-lightning-sorcerer-build/.* Maps to `bolt` with a slow pulse (**NEW**) or a
    short-lived `summon`.

### 1.2 Heavy / nuke (few big slow hits)

1. **Delayed telegraphed meteor.** You mark an area and it lands after a delay, so the player has to predict where enemies will be.
   *Hades II Selene Total Eclipse: 1000 dmg to a large area after 4 s [pub], https://hades2.wiki.fextralife.com/Hexes; Last Epoch
   Meteor [pub].* Maps to `eruption` (single, large) plus a delay. **NEW**: a long telegraph.
2. **Delayed bomb with self-risk.** The highest multiplier in the game (4.5x), always crits, and takes time to detonate. It can hurt
   the caster and enemies can walk out of it. *RL2 White Star [comm/pub], https://gamerant.com/rogue-legacy-2-best-spells/.* This is
   the "risk premium" pattern in its purest form.
3. **Channelled beam.** Hold still and fire a beam that deals up to X over 2-3 s. It commits you to one spot. *Hades II Lunar Ray
   [pub]; D4 Incinerate [recall].* **NEW**: channel.
4. **Hold-to-charge release.** A bar fills while you hold, and letting go fires the empowered version. Dashing cancels and resets the
   charge. *Hades II Omega moves (10-25 Magick) [pub], https://gamerant.com/hades-2-omega-moves-cast-special-attack-explained/.*
   **NEW**: charge input. Hard on keyboard-only controls, but "hold U" is legal.
5. **Delayed curse detonation (Doom).** The hit applies a mark that bursts after a delay. You get the damage without having to stay
   in range. *Hades Ares Curse of Agony: Doom 50 dmg [pub].* It is also Affliction-adjacent.
6. **Opener bonus.** Extra damage against undamaged foes, which rewards picking targets and saving the spell for fresh enemies.
   *Hades Aphrodite Blown Kiss (+50% vs undamaged, longer range) [pub]; Hades II Hestia Highly Flammable (first Scorch +80-200) [pub],
   https://hadescompanion.com/hades2/gods/Hestia.*
7. **Isolation bonus.** Extra damage when the target is alone, which pushes the player to pick off stragglers. *Hades II Hestia
   Snuffed Candle (+15-24%) [pub].*
8. **Execute / cull.** Kills outright below a life threshold, so the spell ends an enemy instead of opening one. *PoE Culling Strike
   [recall]; D4 Barbarian Death Blow resets on kill [recall].* **NEW** hook: bonus vs low HP.
9. **Lobbed arcing shell.** It travels slowly over enemies and bursts where it lands, and the travel time buys extra damage. *Hades
   Dionysus Trippy Shot: 100 dmg, the highest common cast value [pub].*
10. **Leap slam.** You rise, are safe in the air, then crash down for area damage. Delivery and dodge are one action. *Hades II Wolf
    Howl (200) [pub].* Maps to `dash` in place, plus `eruption`.
11. **Meter-charged ultimate.** A normal spell that becomes an empowered version (with i-frames) once a meter filled by dealing
    damage is full. *WoL Signature arcana [pub], maxroll WoL2 guide.* An "every Nth cast is a crit" affix is a cheap version.
12. **Wall-piercing lance.** A line shot that passes through walls and deletes large projectiles. *RL2 Shockwave (100 mana),
    Searing Shot [pub/comm].* Maps to `bolt` + pierce plus projectile deletion (**NEW**).

### 1.3 Crowd / area (hit many at once: bursts, rings, ground)

1. **Pull then burst.** Gather a pack with a vortex, then hit it with an area spell. The play is a two-step combo. *WoL Aqua Vortex
   + Air Spinner [comm], steam thread above; WoL Whirling Tornado (stationary vortex, blocks projectiles, final push) [pub].* Maps to
   `vortex`. Self-contained version: a vortex that ends in its own blast.
2. **Persistent ground zone.** A patch that damages whatever stands in it. *VS Santa Water [pub]; D4 Blizzard/Firewall [recall].*
   Maps to `field`.
3. **Aura around the player.** Constant close damage. You fight by walking into the pack. *VS Garlic (ignores Amount/Duration/Speed)
   [pub].* This overlaps Blade. See 1.5.
4. **Travelling nova.** A slow orb that sheds shards as it flies and bursts at the end. You aim at a lane, not a target. *D4 Frozen
   Orb [recall]; its proc chance is low because it hits so often, see section 2.* Maps to `bolt` + spawn-on-travel (**NEW**).
5. **Nova ring around the caster.** An instant ring. The skill is walking into the right spot first. *Last Epoch Elemental Nova
   (100% effectiveness, the baseline) [pub].* Maps to `eruption` in a ring (**NEW** layout).
6. **Circling bombardment.** Strikes land in a ring that rotates around you, clockwise for one weapon and counter-clockwise for its
   twin. *VS Peachone / Ebony Wings [pub].* Maps to `eruption` scatter around the player.
7. **Random screen strikes.** Lightning hits random enemies. It needs no aim and works as crowd coverage. *VS Lightning Ring [pub].*
8. **Knockback into walls.** An area push that deals impact damage when foes hit walls, so the room's shape becomes a weapon. *Hades
   Poseidon Flood Shot / Tempest Strike [pub].*
9. **Death-burst chain.** Slain foes explode and damage their neighbours, so killing the first enemy clears the pack. *Hades II Hestia
   Flash Fry (60-150) [pub].* A candidate affix.
10. **Placed turret ring.** A cast circle that repeatedly bolts one foe inside it, so area is chosen by placement. *Hades II Zeus
    Storm Ring [pub].* Maps to `field` that fires `bolt`.
11. **Stationary crystal beam.** A placed object that fires a beam straight ahead for 5 s. *Hades Demeter Crystal Beam [pub].*
    Community rates it the worst Demeter boon, see section 4. A cautionary Crowd shape.

### 1.4 Affliction / DoT (burn and poison, keep moving)

1. **Tick DoT with a first-apply burst.** Scorch ticks every second. A separate boon makes the *first* application burst.
   *Hades II Hestia Flame Strike / Highly Flammable [pub].* It lets DoT feel good on contact rather than only later.
2. **Tick-rate acceleration.** "Scorch deals damage 50-125% faster." The same total, sooner. *Hades II Pyro Technique [pub].* A clean
   level or affix axis for Affliction that is not just +damage.
3. **Movement trail.** Sprinting leaves a burning cinder trail, so movement paints damage. *Hades II Hestia Heat Rush (10-25 per
   0.25 s) [pub].* Maps to `field` spawned along the path. **NEW**: trail emitter. This is the most direct "keep moving" mechanic.
4. **Stronger while moving / fires when you stop.** Damage grows with continuous movement, or zones are laid while moving and strike
   when you stop. *VS Vento Sacro; VS Shadow Pinion; VS Celestial Dusting (cooldown drops while moving) [pub].*
5. **Stacking poison to a cap.** Each hit adds a stack up to a cap. *Hades Dionysus Hangover (4 dmg per stack; up to 5 stacks
   [recall]) [pub].* It rewards reapplying on many targets instead of focusing one.
6. **Impact + cloud + status in one throw.** A lobbed bomb that hits, leaves a cloud, and poisons. *RL2 Poison Bomb (75 mana) [pub].*
   Maps to `bolt` → `field`.
7. **Brand / attached emitter.** Stick a sigil on an enemy and it pulses periodically. Recall it to re-target. *PoE Brand skills
   (e.g. Penance Brand, Storm Brand) [recall].* Maps to `summon` attached to an enemy (**NEW**).
8. **Spread on death (contagion).** When an afflicted foe dies, the DoT jumps to its neighbours. *PoE Contagion [recall].* A candidate
   affix. It is our `blight` reading "spreads" instead of "stacks".
9. **Delayed curse (Doom).** See Heavy 5. On Affliction the flavour is "tag many, walk away".
10. **Damage link (Hitch).** Hits on one hitched foe echo to other hitched foes. *Hades II Hera Hitch [pub].*
11. **Final tick crits.** The last burn tick always crits, so a DoT has a payoff moment. *RL2 Fireball, Tesla Spike [pub].*

### 1.5 Blade / melee (live in sword range; spells that circle and strike close; cast by the sword)

1. **Stacking orbit blades.** Each cast adds a blade that orbits you, damage and hit-rate grow per blade, and the oldest blade drops
   off at the cap. It rewards casting it over and over. *PoE Blade Vortex (max 10 blades, 4 s duration, hit every 0.6 s) [pub],
   https://poedb.tw/us/Blade_Vortex.* Maps to `orbit` + stacks (**NEW**).
2. **Plain orbit.** Books circle the player. *VS King Bible [pub].* Our `orbit` today.
3. **Forward dash slash chain.** You move in the aim direction while landing a string of slashes and a big finisher. *WoL Shearing
   Chain (6 x 7 + 15 finisher; enhanced 9 slashes) [pub] (via search excerpt).* Maps to `dash` + multi-hit.
4. **Combo-finisher proc.** Finishing your basic combo triggers a big effect. *Ravenswatch Beowulf Breath of Fire (200% fire on combo
   finish) [comm/pub], https://gamerant.com/ravenswatch-best-worst-new-talents/.* This is our resonance (sword hits cast the spell) in
   its best-rated form: tied to the *finisher*, not to every hit.
5. **Cast-on-hit trigger with a tax.** A spell auto-casts on melee crit, with an internal cooldown and a damage penalty. *PoE Cast On
   Critical Strike (0.15 s cooldown, 10-19% less spell damage) [pub], https://poedb.tw/us/Cast_On_Critical_Strike_Support.* This is
   the reference for how to price resonance.
6. **Retaliate / counter.** Strikes back when you are hit. *VS Victory Sword, Night Sword ("Retaliates") [pub]; Hades II Zeus Divine
   Vengeance (after you take damage the foe is struck, 50% chance to repeat) [pub].* **NEW**: an on-hurt trigger. A counter-stance is
   the active version (a timed block window) [inf].
7. **Deflect.** A melee hit or dash reflects projectiles. *Hades Athena Divine Strike (+40%, deflect) / Divine Dash (community best
   Athena boon) [pub/comm], https://www.thegamer.com/hades-best-worst-standard-boons-each-god/.* It turns bullet-hell pressure into
   offence at close range.
8. **Thrown blade that returns.** Throw the weapon, it bounces or returns, and you are unarmed until then or call it back.
   *Hades Shield of Chaos special, thrown and bouncing [recall]; Hades II Argent Skull lob-and-pick-up [recall].* Maps to `bolt` +
   return (**NEW**).
9. **Blade rift / planted blade.** Plant a spinning blade zone ahead of you or where you dashed. *Hades Ares Slicing Shot (cast sends
   a Blade Rift hurling ahead, 10 dmg per hit) [pub]; Ares Blade Dash (a rift where you dash) [recall].* Maps to `field` (physical) or
   `pillar` that pulses.
10. **Dodge-phase strikes.** The spell includes an i-frame dodge inside its attack animation. *Astral Ascent Ayla's knife spells
    ("several include dodge mechanics") [pub], https://astralascent.wiki.gg/wiki/Spells.*
11. **Mana on hit.** Every melee hit restores the spell resource, so Blade *is* the economy. *Hades II Hestia Cardio Gain (4-10
    Magick per hit) [pub].* We already have sword-earns-mana, so the Blade style can scale that ratio.
12. **Summoned melee dummies.** Autonomous puppets that fight next to you and can be thrown. *Ravenswatch Geppetto [pub, via search
    excerpt of ravenswatch.fandom.com].* Maps to `summon` (melee variant, **NEW**).

---

## 2. How these games balance archetypes against each other

### 2.1 Utility is paid for out of raw damage (Hades, published values)

Hades' Common-rarity Attack boons [pub, https://hades.wiki.fextralife.com/Boons]:

| Boon | Raw bonus | Rider |
|---|---|---|
| Aphrodite Heartbreak Strike | +50% | Weak (the enemy deals less damage) |
| Athena Divine Strike | +40% | Deflect |
| Demeter Frost Strike | +40% | Chill |
| Poseidon Tempest Strike | +30% | Knockback (partly a *downside* for melee) |
| Artemis Deadly Strike | +20% | +15% crit chance |
| Zeus Lightning Strike | chain lightning, 10 dmg | no multiplier |
| Ares Curse of Agony | Doom 50 (delayed) | no multiplier |

Cast boons at Common: Trippy Shot 100 (lobbed, slow) > Crush Shot 90 (short range, Weak) > Phalanx Shot 85 (small area, Deflect) >
True Shot 70 (seeks, crit) > Electric Shot 60 (chains) = Flood Shot 60 (area, knockback).

**[inf] Pattern.** Hades pays for difficulty of delivery and takes away damage for convenience. The lobbed or short-range casts get
the biggest numbers. Seeking and chaining casts get less. Knockback, which pushes enemies out of melee range, gets the smallest
multiplier among the multiplier boons. The same shape works for our spells: `seek` and `chain` should cost base damage, and
close-range or delayed delivery should earn it.

### 2.2 Scaling effectiveness by cadence (Last Epoch, PoE)

- Last Epoch gives every skill an **Added Damage Effectiveness**. Elemental Nova is 100% and Meteor is 900%, so a flat "+10 spell
  fire" adds 10 to Nova and 90 to Meteor. Skills with big mana costs or long cooldowns sit above 100%, and rapid-hit skills sit below
  it [pub, quoted by https://lastepoch.fandom.com/wiki/Combat_Calculations via search excerpt; mechanic confirmed at
  https://maxroll.gg/last-epoch/resources/damage-explained].
  **[inf]** For us: any flat per-hit bonus (an element affix's added burn, a level step) should be scaled by the spell's cast
  interval. Otherwise flat bonuses favour Barrage and percentage bonuses favour Heavy.
- PoE Cast On Critical Strike moved from *bonus* damage (+20-29% more before 3.17) to a *penalty* (10-19% less) with a 0.15 s
  cooldown. Earlier, in 3.5, triggered damage was tied to the attack time of the triggering attack [pub,
  https://poedb.tw/us/Cast_On_Critical_Strike_Support].
  **[inf]** Free casts from melee (our resonance) need an internal cooldown and a damage tax, and ideally scale with the sword's
  swing rate so faster swings do not multiply the output.

### 2.3 Delivery trades: autonomy costs damage

- PoE **Spell Totem**: 50-55% less damage and 40% less cast speed, in exchange for the spell casting itself while you do something
  else [pub, https://poedb.tw/us/Spell_Totem_Support]. **Multiple Totems** gives about 2.4x total with 3 totems at 80% each versus 1
  totem [pub, https://pathofexile.fandom.com/wiki/Multiple_Totems_Support via search excerpt].
- PoE **Trap**: 11-20% less trap damage plus a throw-speed bonus [pub, https://poedb.tw/us/Trap_Support].
- **[inf]** For `summon` and `field`, which keep dealing damage while the player does something else: price them at roughly half the
  per-second damage of a hand-cast spell. That matches PoE's published totem tax and Hades' low value for placed Crystal Beam
  (8 per 0.2 s = 40 dps for 5 s).

### 2.4 Proc coefficients: multi-hit spells get less on-hit value

- Risk of Rain 2: Artificer Flame Bolt has proc coefficient 1.0. MUL-T Nailgun has 0.6 (raised from 0.4), so a 25% on-hit item
  becomes 15%. Fast or multi-hit skills get lower coefficients [pub,
  https://gamerant.com/risk-of-rain-2-ror-2-proc-chain-coefficients-explained/].
- Diablo 4: Frozen Orb Lucky Hit chance was cut from 20% to 4%. It hits so much area that proc passives became degenerate, and the
  4% made those passives nearly dead (0.8% effective) [pub/comm,
  https://us.forums.blizzard.com/en/d4/t/blizz-why-nerf-frozen-orb-lucky-hit-chance-to-4/16914].
- **[inf]** For us: `fork`, `chain`, `repeat`, `count` and `spread` multiply how often on-hit affixes fire (element application,
  resonance). An affix like "on hit: apply burn" should carry a per-cast budget, not a per-hit one. D4's case shows a coefficient cut
  too hard can kill a whole family of affixes, so tune it on purpose.

### 2.5 Resource and cadence rules as the balance lever (D4, WoL, Hades II, Astral Ascent)

- D4 Sorcerer: Basic skills build mana, Core skills spend it, Mastery skills cost mana with no cooldown, Ultimates have a long
  cooldown and only one can be equipped [pub, maxroll overview]. The archetype is fixed by *how you pay*, which leaves the damage
  numbers free to vary.
- WoL: Basic arcana have no cooldown ("you can always fall back on them"). Standard arcana are cooldown-gated and do more damage.
  Signature arcana build a meter and become an empowered version with i-frames [pub, maxroll WoL2 guide].
- Hades II Selene Hexes are not cooldowns. They charge by spending Magick, with thresholds that differ per hex (for example Lunar Ray
  30, Wolf Howl 50, Total Eclipse 90, Phase Shift 130 in the current wiki) [pub, https://hades2.wiki.fextralife.com/Hexes]. Another
  guide lists older values (Lunar Ray 120, Phase Shift 150), so the numbers moved between patches [pub,
  https://www.gamespot.com/articles/hades-2-selene-path-of-stars-guide/1100-6523317/].
  **[inf]** In the current values the delayed large-area nuke (Total Eclipse, 1000 dmg after 4 s) costs 3x the charge of the channel
  beam (Lunar Ray, 800 over 2 s) for only 1.25x the damage. Area and safety are priced higher than raw damage.
- Astral Ascent: spells cost 1-3 mana. A spell is disabled after use until every other equipped spell has been cast (a "spell
  refresh"), which stops the player spamming only the best spell [pub, https://astralascent.wiki.gg/wiki/New_Player_Guide].
  Gambits (4 slots) add effects. Matching the spell's affinity gives +10% per matching gambit and +10% more at 4/4 [pub].

### 2.6 Single-target versus pack

- **[inf]** None of the sources publishes a formula. The recurring pattern is:
  - Area and chain skills get lower per-target values (Electric Shot 60 vs Trippy Shot 100 in Hades; Nova 100% vs Meteor 900% in
    Last Epoch).
  - Area and chain skills get lower proc values (Frozen Orb).
  - Single-target skills get conditional multipliers that only work on few targets (opener bonus, isolation bonus, execute).
- A useful internal rule [inf]: evaluate every spell at two reference fights, one boss and one pack of 6. Require each style's
  signature spells to win at least one of the two by a clear margin and not to lose the other by more than ~2x.

---

## 3. Roster sizes and how offers avoid dilution

### 3.1 Counts

| Game | Unit | Per-archetype count | Total |
|---|---|---|---|
| Hades | boons per god | 12-14 (Ares 12, Dionysus 12, Aphrodite 14, Hermes 14, others 13) | 9 gods; 28 duos; about 10 legendaries |
| Hades II | boons per god | 13-14 core + 1 infusion + 1 legendary | 37 duos |
| Wizard of Legend | arcana per element | 36 each for fire/air/earth/lightning/water, 24 chaos (v1.23) | about 204 |
| Wizard of Legend 2 | base arcana | 18 base + 18 upgraded | 36 |
| Astral Ascent | spells | 48 common, 12 zodiac, 90 hero-specific (about 18 per hero across 5 heroes) | 150+ |
| Rogue Legacy 2 | spells | n/a | 26 |
| Vampire Survivors | base weapons | n/a (delivery categories, not archetypes) | 102 |
| Ravenswatch (Geppetto) | per hero | 4 abilities + 1 trait + 14 upgrades + 2 ultimates | 8+ heroes |
| Selene Hexes (Hades II) | hexes | 9 | 9 |

Sources: [pub] Hades fextralife Boons; Hades II fextralife Boons; WoL counts from the Fandom Arcana page via search excerpt
(https://wizardoflegend.fandom.com/wiki/Arcana); WoL2 https://wizardoflegend2.wiki.gg/wiki/Arcana; Astral Ascent Spells page; RL2
https://roguelegacy.wiki.gg/wiki/Rogue_Legacy_2_spells; VS wiki; Ravenswatch via search excerpt of
https://ravenswatch.fandom.com/wiki/Heroes; Hades II duo count https://rogueranker.com/hades-2-duo-boons/.

**[inf] Reading.** An archetype that feels complete in a roguelike carries roughly **5 "slot" abilities plus 7-9 modifiers**
(Hades), or **about 8-18 abilities** when abilities are the whole unit (WoL2, Astral Ascent per hero, Ravenswatch). Only a few of
these are *actives with distinct use*. In a Hades god, 5 of about 13 boons change what a button does, and the rest are passives or
riders. For our game, where the spell is the unit and affixes are the modifiers, **8-10 distinct spells per style** is in line with
shipped games. Styles can share some spells (see 3.3).

### 3.2 Anti-dilution devices

1. **Cap the number of families per run.** Hades allows at most 4 Olympians per run, not counting Hermes and Chaos. Keepsakes, the
   Charon Mystery boon and some events can add more [comm, https://steamcommunity.com/app/1145360/discussions/0/3005549744945919775
   and search summaries]. Once your 4 gods are set, every god offer comes from a pool you have already invested in.
2. **Guarantee the first offer.** A god keepsake makes the *next* boon offer come from that god [comm/pub,
   https://steamcommunity.com/app/1145360/discussions/1/3106890436333724074/]. This is what our play-style starter already does.
3. **Prefer empty slots.** Gods are more likely to offer core boons for an empty slot (Attack/Special/Cast/Dash/Call) [comm, Hades
   Fandom Boons page via search excerpt]. Once the slots are full, offers move to upgrades and passives.
4. **Prerequisite gating.** Tier-2 boons, duos and legendaries only enter the pool when their prerequisites are held. Examples:
   Zeus's Splitting Bolt needs Storm Lightning, Double Strike or High Voltage. Artemis's Fully Loaded needs 2 of 3 named boons. A duo
   needs one qualifying boon from each god [pub, https://hades.wiki.fextralife.com/Boons]. The pool grows *with* the build rather
   than all at once.
5. **Close the pool when slots are full.** Vampire Survivors has 6 weapon slots. Once they are full, level-ups offer only upgrades to
   the weapons you hold. Evolutions need a max-level weapon plus its passive and a chest [pub, VS wiki]. **[inf]** Our 3 spell keys
   work the same way: once 3 spells are held, offers should mainly be affixes, levels or replacements.
6. **Replace, do not stack.** In Hades II a second boon for an occupied slot *replaces* the first [pub, Hades II fextralife].
   Showing the swap explicitly keeps the pool from bloating.
7. **Duo/legendary as rare payoffs.** Duos exist only for god pairs you are already committed to. Keepsake rank and Mirror talents
   raise their chance [comm].

---

## 4. Pitfalls: dead picks and degenerate picks

### 4.1 Dead or trap picks (and why)

| Pick | Game | Why it is dead | Lesson [inf] |
|---|---|---|---|
| Lightning Reflexes | Hades | Needs a hard-timed dash for 20-50 dmg, and Zeus boons already throw bolts | Do not tie a hard input to a small payoff |
| Hunter Dash | Hades | Takes the Dash slot but only improves the dash-*strike*, not the dash | A spell that buffs a sub-case of its slot wastes the slot |
| Crystal Beam | Hades | A slow placed beam that misses if placement is slightly off | Placed plus directional plus slow means enemies are rarely where the beam points |
| Crush Shot | Hades | Too little range and speed for a cast | Short range must pay far more than 90 vs 60-70 |
| Black Metal | Hades | A numeric area increase you can barely see | An upgrade the player cannot see feels like nothing |
| Quick Favor | Hades | Fills the gauge at 1%/s, too slow to matter | Passive trickles lose to active verbs |
| Ocean's Bounty / economy boons | Hades | Resource value fades once meta-progression is saturated | Keep offers combat-relevant |
| Tranquil Gain | Hades II | Rewards standing still to regen Magick, which is impossible at high Fear | Mechanics that ask you to stop fighting fail under pressure |
| Omega Cast | Hades II | Roots you while charging as waves spawn | A channel or charge needs protection (armour, slow-mo) or a short hold |
| Double Strike (low rarity) | Hades II | A 10% repeat chance is too rare to notice | Small chance-to-repeat is invisible. Use deterministic "every Nth" |
| Hera's cast | Hades II | Only works on newly spawning foes | Conditions that are rarely true make a dead pick |
| Pentagram (base) | Vampire Survivors | Screen wipe also erases XP gems, which breaks the reward loop | Never destroy the player's reward stream |
| Clock Lancet (base) | Vampire Survivors | Purely defensive freeze line, no kill power | Pure control needs a damage hook in the same spell |
| Snowball | Ravenswatch | Crowd control with little payoff, "shouldn't be a priority" | Same as above |
| White Star | Rogue Legacy 2 | Top multiplier but self-damage, and enemies escape the delay. Divisive, ranked mid (#6) | A risk premium only works if the risk is readable |

Sources: https://www.thegamer.com/hades-best-worst-standard-boons-each-god/ [comm]; Hades II search summaries of
https://steamcommunity.com/app/1145350/discussions/0/833872326144617558/ and https://www.thegamer.com/hades-2-best-boons-ranked/
[comm]; https://www.thegamer.com/vampire-survivors-best-strongest-weapons-evolve-tips-guide/ [comm];
https://gamerant.com/ravenswatch-best-worst-new-talents/ [comm]; https://gamerant.com/rogue-legacy-2-best-spells/ [comm].

### 4.2 Degenerate or dominant picks (and why)

- **Proc-heavy area spells.** D4 Frozen Orb needed a 20%→4% Lucky Hit cut [pub/comm, Blizzard forum above]. **[inf]** Area × hit
  count × proc chance grows multiplicatively, and so does fork × chain × on-hit element for us.
- **Free triggered casts.** PoE Cast-on-Crit went from a damage *bonus* to a damage *penalty* plus a cooldown [pub, poedb].
  **[inf]** Resonance with no tax becomes "hold the sword and the spells play themselves".
- **Deflect / projectile deletion.** Athena Divine Dash is the community's best Athena pick. RL2 Shockwave is "essential" against
  late bosses [comm]. **[inf]** In a bullet-pattern game, projectile deletion is worth more than damage and should be priced like a
  defensive slot.
- **Area rider on a spammable cast.** Zeus Electric Shot is "devastating" with Storm Lightning (+8 bounces) [comm]. **[inf]** Chain
  + bounces on a cheap cast is our Barrage fork/chain stack. It needs a per-cast target budget.
- **Global multiplier modifiers in composition systems.** Magicraft's most-cited guide is titled "why Volley is the best spell"
  (https://steamcommunity.com/sharedfiles/filedetails/?id=3477176826; the page rate-limited, so only the title is used here) [comm].
  **[inf]** When modifiers compose, the one that multiplies projectile count dominates. That is one more reason our removal of
  multicast composition was right.

### 4.3 Noita, the cautionary contrast

- Wand editing is Noita's core system and has "a mountain of weird mechanics ... people still discover new things". A cited figure
  says nearly 30% of owners never reach the Coal Pits, the first place wand editing really opens up [comm,
  https://playwanderer.online/game-reviews/noita and Steam thread
  https://steamcommunity.com/app/881100/discussions/0/1749023254242069165/]. The 30% figure comes from achievement stats as
  reported by that source. I did not verify it.
- **[inf]** Composition depth pays off for dedicated players but hides the fun from everyone else. Self-contained spells with ≤3
  affixes are the right side of this trade for a keyboard-only action game.

---

## 5. Implications for jev-rogue (inference, not research)

1. **Define styles by verb, not element.** Barrage = cadence (charge bank, threshold proc, fixed spray). Heavy = commitment (delay,
   channel, hold-to-charge, opener/execute). Crowd = geometry (pull-then-burst, rings, walls, death-burst). Affliction = time profile
   plus movement (trail, first-apply burst, tick acceleration, spread on death). Blade = range band plus sword coupling (stacking
   orbit, dash-slash chain, finisher resonance, deflect, counter).
2. **Aim for 8-10 spells per style with deliberate overlap.** Aura sits in Crowd and Blade. Doom sits in Heavy and Affliction.
   Vortex sits in Crowd and Blade. That gives about 30-35 unique spells for 5 styles × 8-10 slots, in line with WoL2 (36) and a
   Hades II god (about 15).
3. **Budget rules (from section 2):**
   - Seeking, chaining or autonomous delivery pays with base damage. Close-range, delayed or lobbed delivery earns it (Hades casts:
     60-70 vs 90-100).
   - Summons and fields run at about 50% of hand-cast dps (PoE totem).
   - Flat per-hit bonuses scale with cast interval (Last Epoch effectiveness).
   - Resonance gets an internal cooldown plus a damage tax (PoE CoC: 0.15 s, 10-19%).
   - On-hit affixes get a per-cast budget so that fork, chain and count do not multiply procs (RoR2, D4).
4. **Mechanics that need new engine support, by value per style:**
   - hold-to-charge or channel (Heavy)
   - delayed large telegraph (Heavy/Crowd)
   - trail emitter (Affliction)
   - per-enemy damage-threshold counter (Barrage)
   - return/boomerang (Blade/Barrage)
   - stacking orbit (Blade)
   - on-hurt counter (Blade)
   - spread-on-death (Affliction/Crowd)
   - ring layout for `eruption` (Crowd)
5. **Avoid the section-4 traps:**
   - no small-chance repeat (prefer "every 3rd cast")
   - no mechanic that rewards standing still, unless it is short and protected
   - no pure-control spell without damage
   - no upgrade the player cannot see
   - no spell that works only on rare conditions
   - no effect that deletes pickups or mana orbs
6. **Offer rules:**
   - keep the style guarantee on the first offer (keepsake)
   - once 3 spells are held, move offers to affixes, levels and explicit swaps (VS, Hades II replacement)
   - gate high-synergy affixes behind a held prerequisite (Hades tier-2 and duo gating) so the pool grows with the build
