# Art work order — next batch

For whoever draws the next batch of sprites into this repo. It lists every
frame the game is missing or faking today, then the art for the new enemy
attacks and archetypes proposed in `docs/research/enemy-expansion.md`, in the
order they should be drawn.

## How to deliver

The contract is the one the baseline 436-frame atlas was delivered under; Parts A-D expand the production atlas to 896 frames. Read
these sections of `docs/art-workorder.md` before drawing anything: **Hard
rules**, **Sizes**, **Colour**, **Facings**, **The perspective, and the one
rule it imposes**, and **Delivering**. In short:

- Deliver at the stated size, matching `assets/source/style-reference.png`:
  hard stepped pixel edges, flat or two-step shading, a near-black `#0d0b1f`
  outline on every entity, no text in any sprite, soft alpha on edges only.
- Facings: draw `s`, `n` and `w`. **Never draw `e`**; the game mirrors `w`.
  Radially symmetric things (turret class, `vfx_`, `icon_`, `ui_`, `prop_`)
  get one facing.
- Centre every entity on its collision circle.
- **The magenta band (`#ff3fa4`) means exactly one thing: an enemy
  projectile in the air.** Nothing else may touch it. Enemy telegraph accents
  use the warm range around `#ff5544`.
- **Never scale on one axis.** Anything whose length varies at runtime (a
  rift, a tether, a beam) is delivered as a **tileable segment plus end
  caps**; the renderer repeats the segment.
- **Anything that moves apart from the body at runtime is never drawn into
  the body's frame.** Spikes that are driven out and then fly, a thrown
  weapon, a bell's ring, a shield bubble: the body frame shows the body
  only (at most the stub or socket the part comes out of), and the part is
  its own sprite that the renderer places, rotates, extends and releases. A
  part painted into the frame can neither grow out on the attack's clock nor
  leave the body when it is released.
- Icons are **16 × 16**, drawn for the crisp sheet and shown at 2×, like the
  delivered `icon_stat_*` and spell icons.
- Register every new frame in `packages/harness/src/assets/manifest.ts`
  (name, size class, `centred`, and `[w, h]` for 16 × 16 icons or non-square
  frames, following the existing entries), keep the draft next to its
  normalised source under `assets/source/`, then run:

```sh
pnpm assets:art      # packs, validates, decal-checks
pnpm assets:check    # must print OK
```

**Decision for thrown incendiaries** (the proposal's open question 6.2): a
thrown coal, flask or lobbed shot is a projectile while it is in the air, so it
is drawn **in the magenta band** like every other enemy bullet — a hot magenta
core with a darker magenta rim. What it leaves when it lands is the existing
`vfx_groundfire_*`, which is warm. The player learns one rule: magenta in the
air hurts; warm on the floor hurts if you stand in it.

Each row says whether the game **already asks for the frame** (it appears as
soon as it is in the atlas) or whether **the renderer is wired after
delivery** (the code does not look for it yet; that work follows the art).

---

## Part A — owed art for the game as it is

### A1. Enemies

| Frame(s) | Size | Count | What it is | Stands in today | Wiring |
|---|---|---|---|---|---|
| `enemy_lancer_{n,s,w}_{idle0,idle1,walk0,walk1,walk2,walk3,dormant,dormant1,hit0,hit1,windup,lunge}`, `enemy_lancer_death` | 64 | 37 | The rusher's elite form: taller, lean, gold where the rusher is bone. Same family silhouette as the rusher so it reads as "the rusher, grown up". Its attack drives eight spikes out, holds them, then fires them across the room. The body shows eight short gold stubs at the compass points (the sockets the spikes come out of); `windup` is the body curled with the stubs pulled in, `lunge` the body flexed open with the stubs raised. | The rusher sheet tinted gold and scaled 1.15× | after delivery |
| `enemy_lancer_burst` | 64 | 1 | The lancer braced open with eight exposed sockets and **no full spikes baked in**. The renderer overlays eight copies of `vfx_spike_gold`, extends them during the hold, then releases those same layers as projectiles. | Ordinary death frame | after delivery |
| `vfx_spike_bone`, `vfx_spike_gold` | 16 × 6 | 2 | **One spike**, pointing right, base at the left edge, tip at the right: a tapered shaft with a bright tip, bone (rusher) and gold (lancer). The renderer draws eight of them at the compass points, slides each out from its stub to the attack's reach and back (it translates the sprite along its angle; it is never stretched), and for the lancer releases them as the flying bullets. | A two-colour line per spike and a white dot at the tip | after delivery |
| `enemy_sentinel_{idle0,idle1,dormant,dormant1,hit0,hit1,tele,tele1,death}` | 64 | 9 | A fixed green-grey emplacement with a circular pivot socket. **Do not bake the barrel into the body:** it must rotate freely. One facing. | Turret sheet tinted green, barrel drawn as a rectangle every frame | after delivery |
| `weapon_enemy_sentinel_barrel` | 64 | 1 | The sentinel's long barrel pointing right, with its rotation pivot near the left end. It is rendered over the body and rotates continuously toward its sight line. | Rectangle drawn in code | after delivery |
| `shadow_lancer`, `shadow_sentinel` | 64 | 2 | Their floor shadows, as the other seven `shadow_*`. | Borrowed from rusher / turret | after delivery |
| `shadow_boss_p1` | 256 | 1 | The boss's floor shadow (one serves all three phases). | A small procedural ellipse under a 256 px body | asked for already |
| `boss_p{1,2,3}_{windup,commit,hit0,hit1,leap,slam}` | 256 | 18 | Attack poses per phase: arm raised (windup), blow landing (commit), two hit reactions, crouched to leap, fists into the floor (slam). The crowned construct sheds armour plates phase by phase, as the delivered `idle`/`tele` frames do. | Slam reuses `tele`; the leap **hides the sprite** and draws an ellipse | after delivery |
| `weapon_enemy_tank` | 64 | 1 | The tank's greatsword: broad, chipped, held two-handed; drawn pointing right from the grip like `weapon_player_sword` (grip near the left edge). | Three strokes and a crossguard line | after delivery |
| `enemy_rusher_{n,s,w}_{windup,lunge}` — **redraw** | 64 | 6 | The rusher's attack is now `bristle`: spikes driven out all round the body, not a forward thrust. **The spikes are `vfx_spike_bone`, drawn by the renderer over these frames, so draw none of them here.** The body carries short bone stubs where the spikes come out. `windup`: curled tight, stubs pressed flat; `lunge`: body braced and open, stubs raised, nothing longer than a stub. | The old thrust frames with eight spikes drawn in code | asked for already |

| `enemy_{warden,bellringer,snarecaster,delver,cinderling}_{n,s,w}_walk{0,1,2,3}` — **draw** | 96 (warden), 64 | 60 | A real four-frame walk cycle per facing: contact, passing, contact on the other foot, passing. The delivered sheets had one standing column per facing, and all four walk frames were cut from it, so they are the same drawing (measured: 0% difference between frames, against 23–65% for the drawn cycles). The warden is heavy: short steps, the body dropping onto each foot. | A tilt and lift in code on the one drawing | after delivery |
| `enemy_warden_{n,s,w}_{windup,lunge}` — **keep, and match** | 96 | 6 | The warden is a **gunner** now: its right arm is a blunderbuss (the delivered sheet drew it so). `windup` is the gun raised to load and `lunge` the gun levelled to fire, as delivered; the muzzle flash and the blast are drawn in code, so draw neither. The idle and walk frames must show the same gun arm and **no shield**. | — | — |

### A2. Spells, affixes, stats

| Frame | Size | What it is | Stands in today | Wiring |
|---|---|---|---|---|
| `icon_spirit_blades` | 16 | Three small lilac knives circling a point. **The melee style's starting spell** — seen on the style screen, cards and the action bar. | A stat icon, or the spell pedestal | asked for already |
| `icon_wildfire_field` | 16 | A patch of flame on the ground. | Spell pedestal | asked for already |
| `icon_stone_ward` | 16 | A standing stone slab with a rune. | Spell pedestal | asked for already |
| `icon_blink_strike` | 16 | A figure-streak with a blade at its head (dash-through). | Spell pedestal | asked for already |
| `icon_void_maw` | 16 | A purple vortex, drawing inward. | Spell pedestal | asked for already |
| `icon_spirit_ally` | 16 | A small green spirit companion. | Spell pedestal | asked for already |
| `icon_affix_resonance` | 16 | A blade with a ring round it — "every Nth sword hit casts the spell". Same family as the twelve delivered affix icons. | Affix pedestal | asked for already |
| `icon_frost_nova` | 16 | A ring of ice shards bursting outward from a centre point. | Spell pedestal | asked for already |
| `icon_seeker_swarm` | 16 | Three small darts curving in toward one dot. | Spell pedestal | asked for already |
| `icon_fault_line` | 16 | A straight blade of stone breaking up through the floor in a line. | Spell pedestal | asked for already |
| `icon_affix_pierce` | 16 | A bolt passing clean through a small ring — "passes through bodies". Same family as the delivered affix icons. | Affix pedestal | asked for already |
| `icon_affix_seek` | 16 | A bolt on a curving path toward a dot — "bends toward bodies". | Affix pedestal | asked for already |
| `icon_affix_ricochet` | 16 | A bolt glancing off a wall edge at an angle — "bounces off walls". | Affix pedestal | asked for already |
| `icon_affix_kindle` | 16 | A bolt with a flame at its head, fire `#ffb050` — "sets bodies alight". | Affix pedestal | asked for already |
| `icon_affix_rime` | 16 | A bolt with a frost crystal at its head, ice `#9ad8ff` — "chills what it hits". | Affix pedestal | asked for already |
| `icon_affix_blight` | 16 | A bolt dripping green, poison `#9ff07a` — "poisons what it hits". | Affix pedestal | asked for already |
| `icon_affix_haste` | 16 | A cooldown ring with a notch jumping forward — "a kill brings the spell back sooner". | Affix pedestal | asked for already |
| `icon_stat_wrath` | 16 | Survival family: a banked spin — a blade circling, or a charge pip. | Pedestal | asked for already |
| `icon_stat_vigour` — **redraw** | 16 | A **red** heart, the HUD heart's `#b80202` with its highlights. The delivered one is blue (`#3434dc`), the mana colour, so the healing card reads as a mana card. | The 64 px HUD heart, forced by the renderer | asked for already |
| `prop_reward_stat_0` | 64 | The stat reward's pedestal, matching `prop_reward_{spell,affix,gold}_0`: an upward arrow / body sigil on the plinth. | Falls through to the affix pedestal | asked for already |

Projectiles are drawn in code now (`packages/game/src/scenes/projectiles.ts`),
the swing crescent, the magic blade, lightning and the impact rings too. **No
projectile or swing art is wanted.**

### A3. UI

| Frame(s) | Size | Count | What it is | Stands in today | Wiring |
|---|---|---|---|---|---|
| `icon_npc_merchant`, `icon_npc_smith` | 16 | 2 | Portal badges for the vendor rooms: a coin purse; an anvil. | The 64 px vendor sprite squeezed into 16 px | asked for already |
| `icon_action_attack`, `icon_action_spin`, `icon_action_dodge` | 16 | 3 | The three innate verbs on the action bar (J, L, K): a single slash; a blade in a circle; a figure with speed lines. | Two stat icons (attack and spin show the **same** picture) | after delivery |
| `icon_status_{burn,poison,chill,freeze,stun,stagger,alert}` | 16 | 7 | Status marks over heads: a flame; a green drop; a snowflake; an ice block; three stars; a cracked shield; an exclamation mark drawn as a shape, **not as a glyph** (no text in sprites). Warm/cool colours matching the damage numbers: fire `#ffb050`, poison `#9ff07a`, ice `#9ad8ff`. | Triangles, circles, stars and a `"!"` text object | after delivery |
| `ui_shield` | 16 | 1 | The armour mark at the left of an enemy's armour bar: a small heater shield in shield blue `#4f86ff`. | A code polygon | after delivery |

### A4. Map

The map is complete: 16 wall autotile cases, 8 floors, 11 decals, 9
destructibles with their states, the column (64 × 128, split by the renderer
into a footing and a top that goes see-through behind), portals, all six zone
features. **Nothing to draw.** (`tile_floor_4..7` are delivered but the
renderer only uses 0–3; that is a code fix, not art.) The new attacks below
add ground marks of their own (rifts, mines, the slow field, the burrow
mound), listed with them.

---

## Part B — elite attacks for the existing enemies (draw second)

Every elite today is a stat change. Each of these gives an elite of an
existing enemy **a different attack**, built on three new attack kinds —
`rift` (a ground line that erupts), `tether` (a taut line between two things)
and `lob` (an arc with a landing mark). Full behaviour, timings and
counterplay: `docs/research/enemy-expansion.md` §3 and §4.

### B1. The three attack kinds' marks

| Frames | Size | Count | What it is |
|---|---|---|---|
| `vfx_rift_seg_0..3` | 64 | 4 | **Tileable** ground-crack segment, growing across the four frames (telegraph → about to erupt). Warm `#ff5544` light in the crack, never magenta. |
| `vfx_rift_cap_0..1` | 64 | 2 | The rift's two ends, matching the segment. |
| `vfx_rift_burst_0..2` | 64 | 3 | The eruption along a segment: white-hot, on the active frames. |
| `vfx_tether_seg_0..1` | 64 | 2 | **Tileable** ward-tether segment: pale, steady, taut. |
| `vfx_tether_node_0..2` | 64 | 3 | The clasp at each end of a tether, pulsing — what says "both ends land on something" (the sentinel's sight line has one free end; a tether has none). |
| `vfx_ward_aura_0..2` | 64 | 3 | The ring on a warded enemy. Distinct from `vfx_ward_0..1`, which is the player's stone ward. |
| `vfx_lob_shadow_0..2` | 64 | 3 | The ground shadow under a thrown object, growing as it falls. |
| `vfx_lob_ring_0..1` | 64 | 2 | The landing reticle. |

**Drawn versus live**: every telegraph mark reads as *drawn* (dim, still) or
*live* (bright, moving) by **luminance and motion**, never by hue — the room
tint shifts hue by up to 14°.

### B2. The six elite variants

| Elite | New body frames | New VFX | Reuses |
|---|---|---|---|
| Shooter — **Pin Shot** (`lob`) | `enemy_shooter_{n,s,w}_lob` (3): barrel raised at an angle | `vfx_lob_shot_0..3` (4, 32 × 32, **magenta band**) | lob shadow, lob ring |
| Turret — **Rift Lance** (`rift`) | `enemy_turret_telegraph_rift` (1) | — | rift |
| Sentinel — **Sight Beam** (`tether`) | `enemy_sentinel_telegraph_beam` (1) | `vfx_beam_seg_0..3` (4, tileable), `vfx_beam_cap_0..1` (2) | tether node at the muzzle |
| Orbiter — **Seedwake** (`mine`) | — | — | mine marks, Part C |
| Tank — **Shock Cleave** (`rift`) | `enemy_tank_{n,s,w}_cleave_shock` (3): the chop landed, ground splitting under it | — | rift |
| Summoner — **Ward Tether** (`tether`) | `enemy_summoner_{n,s,w}_tether` (3): orb extended toward a minion | — | tether, ward aura |

The elite orbiter's mines are listed in Part C (`vfx_mine_*`); draw them with
this part if Part C is not yet scheduled.

---

## Part C — three new enemies (draw third)

Designs: `docs/research/enemy-expansion.md` §2.1–2.3. Every elite form has a
**different attack**, and its frames are in the second row of each.

| Archetype | Size | Facings | Poses | Frames |
|---|---|---|---|---|
| **Warden** — a shield-bearer: the body carries an arm socket; `weapon_enemy_warden_shield` supplies the tower plate | 96 | n, s, w | `idle0..1`, `walk0..3`, `dormant0..1`, `windup` (shield arm raised), `lunge` (shield arm thrust forward), `plant` (shield arm grounded), `hit0..1` per facing; `death` once. **No shield is baked into these body frames.** | 40 |
| Warden, elite — **Shield Throw** | 96 | n, s, w | `throw_windup` (empty shield arm drawn back), `throw_release`, `idle_bare0..1`; the renderer detaches `weapon_enemy_warden_shield` and changes to `vfx_plate_disc_*` in flight | 12 |
| **Bellringer** — support: a robed figure with a hand bell; arms allies with a ward tether | 64 | n, s, w | `idle0..1`, `walk0..3`, `dormant0..1`, `windup` (bell raised), `cast` (bell struck), `field` (bell rung downward), `burst` (bell cracking — alone, self-destructing), `hit0..1`; `death` once | 43 |
| Bellringer, elite — **Peal** | 64 | n, s, w | `peal_windup` (bell hauled fully back), `peal_release` | 6 |
| **Rifter** — a fixed stone totem that splits the ground in a line toward the player | 64 | one | `dormant`, `idle0..1`, `telegraph` (plates splitting, a warm core), `erupt`, `hit0..1`, `death` | 8 |
| Rifter, elite — **Fissure Walk** | 64 | one | `telegraph_walk` (the core splitting into four) | 1 |

| VFX | Size | Count | What it is |
|---|---|---|---|
| `weapon_enemy_warden_shield` | 64 × 96 | 1 | Upright tower shield with its arm pivot near the left edge; independently placed for guard, bash and throw. |
| `vfx_plate_spark_0..2` | 64 | 3 | A hit absorbed by the Warden's plate: sparks off steel. The only feedback that teaches the mechanic, so it has to be unmistakable. |
| `vfx_plate_disc_0..3` | 64 | 4 | The thrown plate spinning (radially symmetric). |
| `vfx_slowfield_0..3` | 64 | 4 | The Bellringer's slow field: cool, still, flat — deliberately unlike the moving warm `vfx_groundfire_*`. Does no damage. |
| `vfx_peal_ring_0..3` | 128 × 128 | 4 | The elite Bellringer's expanding wave; also its self-destruct ring. |
| `vfx_mine_seed_0..1` | 64 | 2 | An inert seed: a dim pip with a contracting ring. |
| `vfx_mine_armed_0..3` | 64 | 4 | The arming flicker and the live pulse. |
| `vfx_mine_burst_0..2` | 64 | 3 | The detonation. |

---

## Part D — four more enemies (draw last)

Designs: `docs/research/enemy-expansion.md` §2.4–2.7. Body sheets follow the
same pose grammar; exact pose lists are in §6.1 of that document.

| Archetype | Size | Body frames | Elite (different attack) | VFX |
|---|---|---|---|---|
| **Snarecaster** — throws a chain hook that drags the player; whips back after a miss | 64 | 40 | **Chain Mine** — anchors a live chain across the floor (`anchor_cast`, 3) | `vfx_chain_seg_0..1` (tileable), `vfx_chain_hook_0..1`, `vfx_chain_live_0..3` |
| **Delver** — burrows, travels as a mound, erupts under the player | 64 | 49 | **Breach Line** — three emerges in a row (reuses `emerge`) | `vfx_mound_0..3` (the only telegraph that moves), `vfx_emerge_ring_0..2` (earthen) |
| **Cinderling** — feeds on the player's fire: burning makes it faster | 64 | 43 (incl. `burning0..1`: brighter, faster, *pleased*) | **Flare** — a full burn gauge detonates into a fire ring (`flare_windup`, 3) | `vfx_coal_0..3` (32 × 32, **magenta band**, see the decision above) |
| **Sower** — floats and plants delayed mines | 64 | 28 (it floats: `idle0..3` is its drift, no walk) | **Bloom** — a ring of eight seeds with two gaps (`bloom_cast`, 3) | uses `vfx_mine_*` from Part C |

---

## Delivered art the game no longer uses

Do not redraw these. They can stay in the sheet or be dropped; nothing reads
them.

- `bullet_player_{a,b,c}_{0,1}` — player shots are drawn in code.
- `icon_door_{combat,elite,treasure,shop,rest,boss}` — portals show the reward kind.
- `prop_chest_*`, `prop_mirror_*`, `prop_manawell_*`, `prop_restfire_*` — their rooms and features are gone.
- `prop_reward_{gold,spell,affix}_1`, `prop_shop_0/1`, `prop_portal_shut_1`, `prop_pillar_1`, `ui_heart_empty`.
- `enemy_tank_{n,s,w}_tele` — the tank has no ranged tell.
- `weapon_enemy_rusher` — drawn for the rusher's old thrust; no enemy thrusts any more.
- `weapon_enemy_warden_shield`, `enemy_warden_{n,s,w}_{plant,throw_windup,throw_release,idle_bare*}`, `vfx_plate_disc_*` — the warden carries no plate any more.

## Totals

| Part | Frames |
|---|---|
| A — owed art for the game as it is: A1 enemies 138, A2 icons 20, A3 UI 13 | 171 |
| B — elite attacks: the three kinds' marks 22, elite bodies 11, elite VFX 10 | 43 |
| C — Warden, Bellringer, Rifter with elites, their independent shield, and VFX (incl. mines) | 110 + 1 + 24 = 135 |
| D — Snarecaster, Delver, Cinderling, Sower with elites 169, and their VFX 19 | 188 |

Draw **Part A first**: it is what the game shows wrong today. Part B next:
it changes every elite room using silhouettes the player already knows, for a
tenth of the new-enemy art. Parts C and D add new enemies.
