# Enemy and boss design in action roguelikes — a survey

Research notes gathered for the roster in doc 005, when the enemies were
reported as "not fun at all". External sources only; nothing here describes
this repository. Frame numbers are converted to 60 Hz where a source used
another rate. Sourcing strength is uneven and is stated at the end.

## 1. What makes a single enemy fun to fight

**An attack is a three-part contract: anticipation, active frames, recovery.**
GDKeys' *Anatomy of an Attack* gives a floor for a *reactable* windup of
about 36 frames at 60 Hz (player reaction time, plus input time, plus a
difficulty buffer) and dissects Hollow Knight's Hornet: a 15-frame dash
anticipation (reflex tier), a 20-frame throw anticipation with a 35-frame
attack (long enough to fit a two-hit counter), a 30-frame lasso authored as a
healing window. https://gdkeys.com/keys-to-combat-design-1-anatomy-of-an-attack/

**Active frames should be dumb; the windup carries the information.** Nioh's
yokai swings are perfectly horizontal or vertical with no mid-attack tracking
correction; the commitment is what makes the dodge legible. For an eight-way
facing game the transferable rule is: lock the facing at the end of the
windup and never re-aim during active frames.

**Three dials.** Mike Birkhead's combat-designer breakdown: *startup* (longer
is easier to read), *hit* (tighter is harder to land), *recovery* (longer is
easier to punish), with the warning that "speed defeats your power" when fast
attacks also recover fast.
https://jahej.com/alt/2011_05_20_how-to-design-enemies-tips-from-a-combat-designer.html

**Telegraphs are multi-channel.** Particles gathering at the weapon or
barrel, a rising audio cue, a bright flash on release; windows are tuned
*after* watching players miss. http://www.chaoticstupid.com/enemy-attacks-and-telegraphing/

**"Miss the first time" is taught by repetition, not damage.** Death's Door's
developers describe their combat as "learning and reading the telegraphed
movesets of each enemy, and taking advantage of their vulnerability windows":
the difficulty is execution, not guessing.
https://eip.gg/deaths-door/news/developer-interview-soul-searching/

**Feedback.** Vlambeer's *Art of Screenshake*: shake opposite the fire
direction; a 33% chance that an enemy explodes harmlessly on death, purely
for variety.
https://www.gamedeveloper.com/design/vlambeer-co-founder-shares-advice-on-building-better-action-games

**Dead Cells' pillar: assist everything that is not the challenge.** Sébastien
Bénard's GDC 2019 slides ("Control tricks", "Free turn-around", "Auto-aiming")
end on: "Take care of details, especially if they are not part of the
challenge" and "Make it as you remember, not how it actually was."
https://media.gdcvault.com/gdc2019/presentations/Benard-Sebastian-DeepCells.pdf

## 2. Role taxonomy and room composition

Birkhead's taxonomy, which production teams actually use:

- **Emphasizers** reward a mechanic without requiring it: the majority.
- **Enforcers** force a mechanic; use sparingly and make them visually loud,
  because subtle plus mandatory is frustrating.
- **Challengers** are boss-tier, three to four distinct attacks against a
  standard enemy's one or two.
- **Smashers** are cheap fodder with minimal AI.

The test per enemy: *what is this one's trick?* One learnable pattern.

Rosters shipped:

| Game | Count |
|---|---|
| Hades | about 24 enemies in total; roughly 10 / 4 / 5 / 5 per biome (https://hadeswiki.com/wiki/enemies) |
| Enter the Gungeon | about 145 (https://enterthegungeon.fandom.com/wiki/Category:Enemies) |
| Binding of Isaac: Repentance | 336 (https://bindingofisaacrebirth.wiki.gg/wiki/Bestiary_(Repentance)) |
| Wizard of Legend | most enemies in three colour-coded variants (https://wizardoflegend.fandom.com/wiki/Enemies) |
| Nuclear Throne | small per-area sets with tiny HP: 7 to 25 for trash, 100 for the first boss (https://nuclear-throne.fandom.com/wiki/Enemies) |

Hades ships about five types per biome. Breadth is not the lever; *role
contrast inside one room* is. Elysium is the textbook triangle: Exalted
Archer (zoner), Exalted Shieldbearer (frontally protected charger), Exalted
Warrior (bruiser), each leaving a soul that re-arms unless dispatched, so the
room asks "kill order?" twice. https://hades.wiki.fextralife.com/Enemies

Hades' **Soul Catcher** is the cleanest decision object: a stationary orb
emitting contact swarms, destroyable but not deflectable, which punishes being
ignored and costs tempo to remove. https://hades.fandom.com/wiki/Soul_Catcher

Wizard of Legend's mini-boss rooms add basic enemies in inverse proportion to
how many the player already killed on the floor: skipping fights costs later.

## 3. Staying interesting after being solved

- **Hades armour**: a yellow outline and an extra yellow bar; immune to stun
  and knockback until depleted; breaking it stuns briefly. Elites carry
  modified attacks and a skull by the bar. https://hades.fandom.com/wiki/Armored_enemies
- **Gungeon's Jammed**: HP x3.5 + 10, double damage, curse-gated spawn chance
  up to 50%, some new patterns. https://enterthegungeon.wiki.gg/wiki/The_Jammed
- **Dead Cells elites**: each carries a *spatial* modifier rather than a stat:
  a ground laser, an ascending laser, a damaging aura, an electric cage that
  hurts you for leaving, a crystal that volleys, a force field held by two
  respawning crystals. https://deadcells.wiki.gg/wiki/Enemies
- **Wizard of Legend** council bosses gain one attack per council member
  already beaten and shorter vulnerability phases.

The pattern: **an affix changes where you may stand or when you may hit, not
how long the fight lasts.** Gungeon's HP multiplier is the outlier and is an
opt-in gamble.

## 4. Movement threats that are not a straight charge

- **Lockdown, not damage**: Hyper Light Drifter's Crystal Spider encases you
  in a crystal you must mash out of; 1 damage, 1 HP, hunts in packs.
- **Slam that closes between bounces**: Hades' Bone Hydra at 33% turns its
  slam into a triple slam that advances toward you between bounces.
- **Front-arc shield**: Hades' Shieldbearer forces flanking.
- **Arena-eating boss**: Death's Door's Frog King breaks tiles and later
  inhales them, shrinking the arena permanently.
- **Reflectable spin projectile**: Death's Door's Urn Witch.
- **Two tells on one body**: Tunic's Guard Captain; blade to the side is a
  sweep, blade drawn back is a lunge.

## 5. Boss design

Thresholds are the structure. Megaera adds fire and multi-blast around 75%
and summons below; Bone Hydra changes its volley at 66%, its slam at 33%, and
spawns heads just above 25%; Theseus and Asterius is a two-body fight with
indestructible pillars as cover, where kill order is the fight. The Hades
model runs one melee or charge threat and one space-denial pattern at a time,
with pattern density rising per phase while the melee tell stays constant.

Health bar conventions (practitioner sources, not developer talks):
horizontal, segmented to expose phase count, a delayed ghost fill so a big
hit reads as progress, the bar appearing with the boss's awareness. Armour as
a second, differently coloured bar stacked on the health bar, plus an outline
on the sprite.

## 6. Failure modes

1. HP sponges.
2. Over-complex single enemies: one trick each, one or two attacks for trash.
3. Subtle enforcement: a required mechanic needs a loud tell.
4. Attacks that track during active frames.
5. Windups under the reaction floor (about 36 frames at 60 Hz) used as reads
   rather than budgeted as reflex checks.
6. Friction in the parts that are not the challenge.
7. Undodgeable contact damage; where it exists it is survivable by design.

## 7. Recommendations for a roster of about eight archetypes and one boss

Conventions: facing locks at the end of the windup, no tracking in active
frames; amber for dodgeable, red for must-leave-the-area, white flash on the
active frame; a rising pitch through the windup; armour as a yellow outline
plus a stacked yellow bar.

1. **Hound** (chaser). Low HP; a 20-frame lunge of a fixed three-tile travel
   that cannot re-aim. Decision: bait it into open space or pin it on a wall.
   Punish: 24 frames at the end of the lunge.
2. **Spitter** (zoner). Three-shot fan every two seconds; repositions when
   closed on. Decision: eat chip to clear melee first, or spend a dash
   crossing. Tell: 36-frame shoulder raise with an amber orb. Punish: a
   30-frame reload during which it cannot move.
3. **Slammer** (ring with a safe centre). Damage is a ring with a safe inner
   circle at its feet. Decision: move *toward* it. Tell: 45 frames, a red
   ground decal showing the exact inner and outer radius. Punish: 36 frames.
4. **Bulwark** (shield). A frontal 180-degree arc blocks and reflects chip;
   a short shield bash. Decision: flank, or spend a spell that ignores facing.
   Punish: 40 frames of exposed back after the bash.
5. **Grappler** (hook). A slow visible chain that yanks you into melee range
   and into the room's other arcs. Tell: the chain line drawn on the floor
   before it fires, 40 frames. Punish: 50 frames of retract; dodging through
   the chain works, which teaches the i-frames.
6. **Rootcaller** (ground eruption that follows). Four floor cracks walking
   toward your current position, one every 12 frames, each erupting 24
   frames after it appears. Decision: keep moving laterally. Punish: rooted
   for the whole sequence plus 30 frames.
7. **Blinker** (teleport behind). Vanishes, reappears behind your facing
   after a fixed 30 frames, stabs in 18. Tell: a shadow at the destination
   12 frames before arrival. Punish: 30 frames after the stab.
8. **Bell-Caster** (support, the kill-priority object). Never attacks; beams
   armour onto a nearby enemy. Decision: the pure kill-order question.
   Fragile.
9. **Kamikaze Mote**. Commits to a straight glide and detonates on a fixed
   timer whether or not it arrived; killing it early still detonates it.
   Decision: pull it onto a cluster.
10. **Elite affix set**: armoured (Hades), warded (invulnerable while two
    respawning crystals live), caged (a ring aura that hurts you for
    leaving). Each changes where you stand; none multiplies HP.
11. **Boss, three phases, segmented bar.** Phase 1 melee only with two tells
    (side-held blade is a sweep, drawn-back blade is a fixed lunge). Phase 2
    gains armour, a ring slam with a safe centre, a five-shot spread, and two
    Bell-Casters at the edges. Phase 3 slams destroy tiles permanently and
    the sweep becomes a triple sweep that advances between swings; adds stop.
    One melee and one pattern threat at a time; a 60-frame invulnerable roar
    at each transition that is also a free reposition window.

## Sources and their strength

Developer voice: Bénard's GDC 2019 Dead Cells talk and slides
(https://www.gdcvault.com/play/1025788/-Dead-Cells-What-the), Nijman's *Art
of Screenshake*, Birkhead's combat-designer post, the Acid Nerve interview on
Death's Door. Community wikis (accurate, not developer statements): Hades,
Gungeon, Isaac, Wizard of Legend, Nuclear Throne, Hyper Light Drifter,
Dead Cells. Practitioner blogs and a UI reference database for health-bar
conventions (https://medium.com/@dcargile84/designing-a-boss-bonus-creating-a-health-bar-87a8a1e87bfb,
https://www.gameuidatabase.com/index.php?scrn=143). No Supergiant developer
statement specifically on enemy or encounter design was found in text form.
