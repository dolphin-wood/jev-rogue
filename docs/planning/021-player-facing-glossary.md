---
id: 021
title: Player-Facing Glossary (en / zh / ja)
status: accepted
date: 2026-09-25
summary: One word per concept in each of the three languages the game ships. Every recurring game term — HP, mana, gold, dash, sword, spell, school, elements, statuses, affix, tier, level, experience, upgrade, elite, boss, floor, room, merchant, blacksmith, fountain, reward, stat, cooldown, cast, damage, invulnerability, rage, and the Director and Jev words the player sees — with the one rendering the UI uses. Doc 010 is the vocabulary Jev is sent; this is the vocabulary the player is shown, and the two never have to match.
depends_on: [010]
---

# 021 Player-Facing Glossary

## Why

Doc 010 fixes the closed vocabulary **Jev** sees. Nothing in it reaches the
player: the ids stay English on the wire (doc 002) and `i18n/terms-*.ts` is a
display layer over them. So the player-facing wording is a second vocabulary,
and until this table existed it was decided one string at a time — which is how
the same move came to be a "dodge roll" on the controls page, a "Dash" on the
character screen and a `dash_range` stat, and how 「付与」 and 「付与効果」 both
ended up naming an affix.

The rule for all three languages is the same: **write the word the genre's own
releases use**, not the word a dictionary gives for the English. A roguelite's
UI in Japanese says 「HP」 and 「回復の泉」, not 「体力」 and 「泉の水を飲む」; in
Chinese it says 「闪避」、「回旋斩」、「词条」. English gets the same treatment:
short, one word per idea, no synonyms.

Where a term is tight for space the short form is given too; a longer phrase is
never used where the short one already appears elsewhere.

## The table

### The body and the bars

| Concept | en | zh | ja |
|---|---|---|---|
| health, the bar | Health | 生命 | HP |
| a heart / segment | segment | 格 | ゲージ |
| mana | Mana | 法力 | マナ |
| mana regeneration | mana regen | 法力回复 | マナ回復 |
| mana returned on a sword hit | mana per hit | 命中回法力 | 命中時マナ回復 |
| rage, the spin-attack gauge | Rage | 怒气 | 怒り |
| gold | Gold | 金币 | ゴールド |
| invulnerability after a hit | Invulnerability | 无敌时间 | 無敵時間 |

`Health` is the label; the fountain and the results screen say "health" too.
Japanese uses 「HP」 everywhere, including in stat lines (`HP +{n}`) — 「体力」
is a novel's word, not a HUD's.

### Moving and swinging

| Concept | en | zh | ja |
|---|---|---|---|
| the i-frame dodge move | Dash | 闪避 | 回避 |
| its distance / its cooldown | dash range / dash cooldown | 闪避距离 / 闪避冷却 | 回避距離 / 回避クールダウン |
| move speed | move speed | 移动速度 | 移動速度 |
| the sword | Sword | 剑 | 剣 |
| a sword swing | swing | 挥剑 | 剣を振る |
| reach | reach | 剑的范围 | 間合い |
| recovery after a swing | swing recovery | 挥剑后摇 | 振り後の隙 |
| the rage-spending attack | Spin attack | 回旋斩 | 回転斬り |

**Never "roll" or "dodge roll" in English** — one move, one word, `Dash`. The
spell *shape* that carries the player forward is a different thing and is named
`dash` (en) / 「突进」 (zh) / 「突進」 (ja) so a spell is never confused with the
button.

### Spells

| Concept | en | zh | ja |
|---|---|---|---|
| spell | Spell | 法术 | 呪文 |
| to cast | cast | 施放 | 詠唱 |
| cast time / interval | cast time | 施法时间 | 詠唱時間 |
| cooldown | cooldown | 冷却 | クールダウン |
| mana cost | mana cost | 法力消耗 | マナ消費 |
| school (flame, frost, …) | school | 系别 | 系統 |
| the staff, the three keys | staff / key | 法杖 / 键位 | 杖 / キー |
| projectile count | projectiles | 弹数 | 弾数 |
| projectile speed | speed | 弹速 | 弾速 |

One word for cooldown in each language. Japanese had 「再使用」 and
「クールダウン」 side by side; only 「クールダウン」 survives.

`school` is 「系别」 in Chinese, never 「流派」 — 「流派」 is reserved for the five
play styles below, and the two were colliding on the Director pages.

### Elements and statuses

| Concept | en | zh | ja |
|---|---|---|---|
| fire | fire | 火焰 | 炎 |
| ice | ice | 寒冰 | 氷 |
| poison | poison | 剧毒 | 毒 |
| burn (the status) | Burn | 灼烧 | 燃焼 |
| poison (the status) | Poison | 中毒 | 毒 |
| chill (building toward a freeze) | chill | 冰缓 | 凍え |
| freeze | Freeze | 冻结 | 凍結 |
| shatter a frozen body | shatter | 碎冰 | 砕氷 |

The short tag forms 「火 / 冰 / 毒」 and 「炎 / 氷 / 毒」 stay on the Director
pages, where they label a tag rather than a damage type.

### Cards, rewards and progression

| Concept | en | zh | ja |
|---|---|---|---|
| reward | reward | 奖励 | 報酬 |
| a reward card | card | 卡牌 | カード |
| spell card | SPELL | 法术 | 呪文 |
| upgrade card (a level for a held spell) | UPGRADE | 强化 | 強化 |
| stat card | STAT | 属性 | ステータス |
| affix | AFFIX | 词条 | 付与効果 |
| an affix slot | affix slot | 词条槽 | 付与枠 |
| affix tier | tier | 阶 | ランク |
| spell level | Lv | Lv | Lv |
| to raise a spell's level | raise | 升级 | 強化 |
| experience, what a kill pays | XP | 经验 | 経験値 |
| the player's own level | Level | 等级 | レベル |
| its short form, on the HUD | Lv {n} | Lv {n} | Lv {n} |
| gaining one | LEVEL {n} | 升级 {n} | レベルアップ {n} |
| grade (common/rare/legendary) | COMMON / RARE / LEGENDARY | 普通 / 稀有 / 传奇 | コモン / レア / レジェンダリー |
| to dismantle for gold | dismantle | 拆解 | 分解 |

「词条」 is the word Chinese players use for a rolled modifier, and it is used
everywhere an affix is named. Japanese picks **「付与効果」** over the bare
「付与」; the slot is 「付与枠」, which is the natural compound and the only
form that fits the 150 px key row on the character screen.

Chinese says 「阶」 for an affix tier and 「Lv」 for a spell level, never 「等级」
in one place and 「Lv」 in another. Japanese says 「ランク」 for a tier (never
「ティア」) and 「Lv」 for a level.

**The player's level and a spell's level are two things and the table keeps
them apart.** A spell's is always the bare 「Lv」 in all three languages; the
player's is the word — `Level` / 「等级」 / 「レベル」 — wherever there is room
for it, and only falls back to 「Lv {n}」 in the HUD corner, where it stands
next to the experience bar and nothing else could be meant. Chinese therefore
does use 「等级」, for the body and never for a spell, which is what the rule
above was protecting. Experience is 「经验」 / 「経験値」; it is never called a
currency, because it buys nothing and cannot be spent.

### The run

| Concept | en | zh | ja |
|---|---|---|---|
| the run's unit | Floor {n} | 第 {n} 层 | 第 {n} 層 |
| a run | run | 一局 | ラン |
| room (the space) | room | 房间 | 部屋 |
| combat / elite / treasure / shop / rest / boss | Combat / Elite / Treasure / Shop / Rest / Boss | 战斗 / 精英 / 宝藏 / 商店 / 休息 / Boss | 戦闘 / エリート / 宝庫 / ショップ / 休息 / ボス |
| an enemy | enemy ("bodies" on the Director pages) | 敌人 | 敵 |
| elite | elite | 精英 | エリート |
| boss | boss | Boss | ボス |
| the boss's title | The Floor's Master | 层主 | この階の主 |
| portal / door | portal / door | 传送门 / 门 | ポータル / 扉 |
| the merchant | The Merchant | 商人 | 商人 |
| the blacksmith | The Blacksmith | 铁匠 | 鍛冶屋 |
| the fountain | The Fountain | 生命之泉 | 回復の泉 |

**Floor is the unit of progress.** Anything that counts rooms in sequence —
"the next room", "the last room", "rooms cleared" — is said in floors:
「下一层」、「上一层」、「通过层数」 and 「次の階」、「前の階」、「踏破した階層」.
`room` / 「房间」 / 「部屋」 is kept for the *space*: its shape, its size, its
mood, its layout.

The fountain is never "drink the water from the fountain". It is a healing
station with a name: 「生命之泉」, 「回復の泉」.

### The five play styles

| Style id | en | zh | ja |
|---|---|---|---|
| spam | Barrage | 弹幕 | 弾幕 |
| nuke | Heavy | 重击 | 一撃 |
| area | Crowd | 群攻 | 範囲 |
| dot | Affliction | 侵蚀 | 継続 |
| melee | Blade | 剑斗 | 剣戟 |
| the concept itself | style | 流派 | スタイル |

The raw ids (`SPAM`, `NUKE`, …) are never shown: they are English identifiers
with no meaning for a player in any language, and the style already has a name
and a blurb.

### The Director

| Concept | en | zh | ja |
|---|---|---|---|
| the Director | Director | 导演 | ディレクター |
| the LLM arm | Jev Director | Jev 导演 | Jev ディレクター |
| the code arm | Rule | 规则 | ルール |
| the plan page | Director Decisions | 导演决策 | ディレクターの判断 |
| what it was sent | Director Inputs | 导演输入 | ディレクター入力 |
| what it was asked | Director Questions | 导演提问 | ディレクターの問い |
| tension | tension | 张力 | 緊張 |
| an invitation code | Invitation code | 邀请码 | 招待コード |

**Text quoted from the wire stays English.** The briefing and the per-key lines
under `held_spells` are what Jev was actually sent; both are shown under a
translated label that says so, and both are drawn as a quotation rather than
translated (doc 002: a run planned in Chinese is the same run planned in
English).

## Rules of register

- **Buttons and rows are nouns, not sentences.** en `Verify and save`, zh
  「验证并保存」, ja 「確認して保存」 — never 「〜してください」 on a button.
- **Japanese takes no polite endings in the UI.** Body copy that explains
  something may use 〜ます; a label, a prompt or a toast does not.
- **Chinese takes no 「的」 padding.** 「闪避距离」, not 「闪避的距离」.
- **A placeholder keeps its slot and its meaning.** `{gold}`, `{coin}`,
  `[E]`, `{pips:a/b}` are markup and survive every translation intact; the
  test in `i18n.test.ts` enforces it.
- **Lengths are fitted to the box, not to the English.** The reward card is a
  fixed 128×196; a CJK line there holds about eleven full-width characters.
