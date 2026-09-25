# Crypt King — movement and animation design

This is a choreography brief for the approved three-phase **concept**, not a
change to combat rules or a sprite delivery. Read with
[`art-workorder-boss.md`](art-workorder-boss.md) and
[`020-the-crypt-king.md`](planning/020-the-crypt-king.md). The concept drawings
remain in `art-review/`; they are not production pixel art.

Motion previews, also concept-only:

- [Slash: guard → load → contact → overshoot → recover](../art-review/crypt-king-slash-choreography-v1.png).
- [Slam (top) versus quake (bottom)](../art-review/crypt-king-slam-quake-choreography-v1.png).

## Motion language

The king is held upright by his chains. Phase I looks *controlled*: a heavy
step, a held silhouette, then a decisive stroke. Phase II lets the shoulders
and free chains overshoot the body. In phase III the core pulls the bones into
motion; the king is quicker to recover, but every attack retains its existing
telegraph and punish window. The phase difference comes from secondary motion
and the already-authored timing, not shorter visual warnings.

Historical two-handed sword sources suggest the physical grammar, not a
literal reconstruction. Meyer's diagonal cut comes from the shoulder and his
middle cut crosses the body; his footwork chapter has the step happen with the
cut, not after it. Figueiredo's montante exercise starts point-down, pairs
alternating cuts with steps, and turns the body toward the cut. For this boss:
**foot plants and hip turn lead the hands; the sword follows; cape and chains
follow last**. End each attack in a distinct position, then bring the weapon
back through a visible recovery. These are staging inferences from the
sources, not claims that the supernatural attacks are historical techniques.

- Meyer, *Gründtliche Beschreibung* (1570), [cuts](https://www.sprechfenster.org/meyer/1570/longsword-chapter-4-the-cuts/), [steps](https://www.sprechfenster.org/meyer/1570/longsword-chapter-7-steps/), [withdrawal](https://www.sprechfenster.org/meyer/1570/longsword-chapter-6-the-withdrawal/).
- Figueiredo, *Memorial of the Practice of the Montante* (1651), [Rules I and II, translation pp. 8–9](https://hroarr.com/manuals/iberian/Figueiredo-Diogo-Gomes-de-Montante-Translation-Myers-and-Hick-1651.pdf).

The music runs at 168 BPM (about 357 ms per beat). The **start of the active
hitbox** or cast event meets the sim's beat. The sword then travels through
the active interval; a drawing must not imply an earlier hit. For a two-beat
telegraph, move through a readable preparation during beat one and hold the
loaded silhouette near the end of beat two. The moment of stillness before
the downbeat makes the impact heavier than continuous flailing would.

## Separate layers and anchors

### Humanoid part rig

**Yes: the new king must be split into a hierarchical, jointed sprite model.**
The existing `boss_p1`/`boss_p2`/`boss_p3` model files describe the old ring
of plates (a core and six floating plates); they are not a humanoid rig for
this design. Doc 016's production model composes drawn pixel parts at
whole-pixel joint offsets and switches part variants for changed angles. The
`rig2` continuously rotated skeleton is a comparison prototype, not the
pipeline to rely on here. Treat the motion boards as a guide to **which
variants to draw**, not six flattened whole-body frames to cut up after the
fact.

Proposed hierarchy and depth groups, shared in proportion across phases:

```text
ground / root
├─ left_foot, right_foot                 planted contact, separate step variants
└─ pelvis → torso / ribcage / heart       weight and phase identity
   ├─ left_leg, right_leg                 drawn thigh/shin variants for step, crouch, kneel
   ├─ cape_left, cape_right              delayed silhouette, behind body
   ├─ head → crown                       crown stays seated until death
   ├─ left_shoulder → upper_arm → forearm → hand_overlay
   └─ right_shoulder → upper_arm → forearm → hand_overlay

detached/rendered independently: greatsword, live chain links and terminal tips,
                               removable pauldrons/helm/breastplate halves
```

The shoulder/upper-arm/forearm division is needed for a real two-handed
high guard, a low planted blade, and a one-handed hook; moving whole arms a
few pixels would not put both fists on the hilt through those poses. Draw
small overlapping joint covers or internal ink at the elbow and shoulder,
and trace the exterior outline after composition so changing a variant does
not open a black seam. Feet are separate roots, allowing a planted lead foot
while the torso drives past it; bent thigh/shin variants close the silhouette
for the leap gather and one-knee slam. The cape can use two or three broad pieces;
splitting every rag into a bone would add seams without improving the motion.

Keep at least `shoulder_l/r`, `elbow_l/r`, `hand_l/r`, `hip_l/r`,
`foot_l/r`, `chain_root_l/r`, and `core` as named body anchors, plus `sword_tip`
on the separate weapon. The
phase III third-chain root is `core`. Poses select *drawn* arm/hand variants
for high guard, low plant, cut, follow-through and one-handed release; they
only offset those parts by whole art pixels. The body does not continuously
rotate cut-out bitmaps. Transition pieces are detached at the phase bar line:
phase I sheds pauldrons and helm; phase II sheds the breastplate halves and
cape; phase III retains the crown, sword, core and three chain roots. The
three phases preserve the same ground point and joint scale.

The greatsword is **one rigid weapon drawing shared by all phases**, cut out
and rendered about a grip anchor. It does not need a full character model of
its own. Author `grip_main`, `grip_off`, `crossguard`, and `tip` anchors. Body
poses carry the hands to the hilt; hand overlays cover the grip. During a
two-handed stroke the off hand follows the hilt. During hook/throw it lets go
and the sword falls back into the right hand. The sword passes behind the
upper body on the backswing and in front on the contact/follow-through; the
two hand overlays sort above it where they grip. The active sword angle must
come from the simulation's `SwingBox`, not from a five-pose timer.

The chains have a short attachment drawing on the body and a repeatable link
plus terminal link rendered along the **actual** `Arm` or hook tether path.
An idle hanging chain may be posed, but the attack chain cannot be baked into
a 256 px body frame: the lash has one/two/three rotating arms and the hook
changes direction and length. In phase I–II a chain's root is concealed at
the cuff/wrist; in phase III all three emerge from the heart. The root-to-hit
geometry bridge must not look detached.

The work order's south-only facing is sufficient for the throne, entrance,
phase reveal, and death. It is not sufficient for aimed, two-handed combat:
the player can circle behind a humanoid king while the sim aims its sword in
any direction. Author north and west **combat torso/head/arm variants** (east
mirrors west), at least for guard, loaded cut, active cut, raised chop, charge,
and backhand. Reuse legs/cape and shared sword/chain parts where the silhouette
permits. Avoid tripling every 256 px atlas frame; this project targets a 4096
texture, so the additional views should be selective and part based.

## Ground-origin contract

The current slam shockwave, quake cracks, and leap landing originate from the
boss's **ground position** (`e.x`, `e.y`), not an arbitrary sword-tip point.
Changing that origin would alter counterplay. At a plant/landing contact pose,
put the sword tip visually on that ground point (after the leap snaps to its
landing tile). The effect may appear to burst from the tip *because the tip is
there*. A drifting tip is an art/rig defect; moving the gameplay effect to
follow it is not the fix. Apply the same principle to chain roots: show the
short visual link from the anatomical anchor to the sim's tether/arm origin.

## Attack score

All percentages are **animation beats within the existing move window**, not
new gameplay timings. Drive them from `attackMs`/`windupMs`, `bossCommitAt`,
`bossCastEndAt`, and `bossLift` so hitstop does not put the picture off the
music. The live `SwingBox.angle` owns the sword during melee active frames.

| Move and real window | Preparation / readable silhouette | On the commit beat and through active time | Follow-through / opening |
|---|---|---|---|
| **Slash**, phase I; 60° sweep, 220 ms active | Front foot light; weight loads onto rear foot. Sword comes to the king's right shoulder, hands apart enough to see the hilt. Head watches the player, shoulders turn last. | Lead foot plants as the hips open; diagonal right-to-left cut follows the sim angle through its 60° arc. Cloth and chains lag behind. | Blade finishes low outside the left hip. Hold the overshoot for a beat of perception, then draw it back across the body during the existing 520 ms recovery. |
| **Charge**, phases II–III; no sweep, 700 ms travel, 440 ms skid | Two hands lower the sword into a forward-pointing guard, stance narrows, cape draws in. The floor lane is the decision cue. | Blade stays forward, aligned to the locked charge direction. Legs cycle underneath; do **not** substitute a lateral slash at the end of the run. | Front foot brakes, rear foot skids through, cape and chains continue forward and settle during the existing recovery. Wall stun gets a stronger brace/collapse variant. |
| **Cleave**, phases II–III; 44° wedge, 240 ms active | High guard over the head. Forearms, crown and point form one tall silhouette, held through the 620 ms or beat-extended windup. | Short step and vertical drop along the aimed wedge; the sword does not sweep sideways. The near foot lands with the active onset. | Sword stays low briefly, then the king levers it up through the existing 640 ms recovery. |
| **Backhand / maul**, any phase; 90° sweep, 260 ms active | The tightening overstay ring is already the long tell. On the short final windup, pull the hilt across the waist and twist the torso away, compressing the silhouette. | A reverse waist-height cut drives hilt first and whips the blade through the full sim arc. It must visibly reach the 2.4-tile threat; a literal short pommel poke would contradict the hitbox. | The arms overrun the torso; rear foot catches the weight. This is a conspicuous punish window while the blade returns over 600 ms. |
| **Slam**, all phases; 2-beat tell, downbeat impact | Beat one: pull the planted sword out and raise it centrally, shoulders lifting. Beat two: front foot advances, torso folds and pauses in a high, narrow silhouette. | Drop onto one knee; both hands ram the tip onto the boss's ground origin. The shockwave and bullet ring start on this contact frame, with the existing hitstop. | Hold the planted pose while the band travels; rise using sword as support. Phase III's second band gets a visible second wrench, not a second untelegraphed leap. |
| **Quake**, all phases; 2-beat tell, downbeat cracks | Unlike slam, the blade stays low and is levered into the floor. Beat one sets the tip at the ground origin; beat two twists the king's shoulders against the planted sword. The closing floor tell remains primary. | A short sideways wrench on the hilt releases the four cracks from that point; no overhead drop silhouette. | Keep the point grounded as the cracks grow. Phase III's scheduled second set of four cracks gets another shoulder turn into the first gaps; that motion must coincide with the second damaging event. |
| **Leap**, phases II–III; 1 beat gather + 3 beats flight | Sink onto both legs during the 357 ms gather, sword low and behind; cape bunches down. The full landing mark is visible from the start. | Push off with the rear foot. Raise the sword over the head as the sim moves the boss and `bossLift` arches it above its moving shadow. Knees tuck near apex; cape opens upward, then streams back on descent. | On the downbeat, sword tip meets the landing ground point, one knee drops, dust/hitstop/shockwave fire together. Keep the low landing for the existing half-second opening before recovery. |
| **Hook**, phase III's rotation; 3-beat aim | Right hand holds sword behind the hip. Left arm extends toward the locked line, or directs the chain from the heart in phase III. Chain lies on the floor for the full aim window. | Left shoulder snaps back as the tether leaves; the drawn chain must follow the sim tether, not a separately animated arc. | If the tether catches, brace with staggered feet and reel from hips/back; otherwise pull the arm in without snapping straight to idle. |
| **Lash**, all phases; 2-beat hold + 1.8/2.0/2.2 s sweep | Cuffs/heart release one/two/three chains to their **full** telegraphed lengths. The king walks slowly and may keep firing. Body remains legible behind the held chains. | The roots begin turning on the beat in the alternating sim direction. Torso counter-rotates slightly as the chains sweep; do not spin the whole body or change the chain's collision radius. | Chains recoil behind the torso in a delayed wave while feet keep their walk cadence. The move ends only after the actual arms withdraw. |

### Transitions, volleys, and death

- **Idle/volley:** a small sternum expansion and delayed chain sway. The
  visible heart pulses with phase intensity, but not in the protected magenta
  bullet hue. Keep the sword planted and the core unobscured while patterns
  fire; these are secondary layer changes, not a new full-body key per shot.
- **Phase I → II:** on the phase bar line the pauldrons/helm burst away in
  readable directions, skull and heart appear in the same position, crown
  stays seated, then the free chains settle. Do not move the collision body.
- **Phase II → III:** breastplate/cape tear free; the crown stays seated, the third
  chain pulls out from the heart, and the now exposed ribs stretch. Settle
  exactly at the next bar line before the faster phase movement begins.
- **Death:** the existing three story beats are sufficient if the sword is a
  separate held/grounded part and crown/chains have their own trajectories:
  one-knee plant, core gutters, then collapse and crown roll. Time the core
  extinction and final sword ring to the musical cadence, not a generic fade.

## Key-pose budget and review gates

The existing ten B3 poses are useful **extremes**, but sharing one `windup`
and one `commit` among slash, charge and cleave would erase their different
counterplay. Add these body keys before requesting a full sprite sheet:

1. `blade_follow` and `blade_recover` (a landed cut must not snap to idle).
2. `slam_raise` and `quake_wrench` (different threats need different bodies).
3. `leap_land` (the contact silhouette must match the ground event).
4. `hook_reel` and `backhand_windup` (the release and the reverse cut need
   their own preparations).
5. For phases II–III, `charge_brace`/`charge_run` and `cleave_raise`.

These are **source poses**, not one atlas frame for each rendered tick. Reuse
parts and generate whole-pixel in-betweens for posture, with the rigid sword
and live chains updating continuously. Draw at least two distinct leg shapes
for the long charge; walking an identical planted foot under a moving body
will slide. Decide the final frame count by flipping each move at 1× in the
arena against the music, not by an arbitrary FPS target. A motion passes when:

- At the first active sim step, the planted foot, sword direction and
  telegraph/hit geometry agree; there is no visible hit before that step.
- Every slash, cleave and maul has a readable loaded silhouette, contact,
  overshoot and recovery, including when a beat holds the windup longer.
- A north/side aimed attack reads as a turn, with sword/body/hand depth
  switching coherently; east is a mirror of west.
- Slam/quake/leap sword tips meet the unchanged sim ground origin; lash and
  hook links follow their existing collision paths.
- Phase changes and hitstop can occur in any move without snapping the sword
  or leaving a chain visually detached. Test at actual 168 BPM with audio.

The original ten-key `5 × 2` layout in `art-workorder-boss.md` will need a
revised inventory after this choreography is accepted. Do not feed the
1254 px concept PNGs to the production splitter: they have soft alpha and
are not authored on the required 256 px logical grid. Production identity
and part art must be drawn at its final grid resolution.
