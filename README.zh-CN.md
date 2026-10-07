# jev-rogue

[English](README.md) · **简体中文** · [日本語](README.ja.md)

一款俯视角动作房间 Roguelike 游戏，由 TypeSafe AI 的选择模型 [Jev](https://docs.typesafe.ai/) 担任「导演」。Jev 从游戏预先给出的**合法选项**中判断什么适合当前战局；房间、遭遇、奖励和战斗仍由游戏代码生成与执行。

## 预告片

不到 30 秒的一局：选风格、用一句话说明想要什么、战斗，然后看 Jev 挑选奖励卡和下一扇门。

https://github.com/user-attachments/assets/3a7ad7b9-ef1a-4b4b-8be7-4ae9413a9a94

## 为什么用 Jev？

AI 可以代替人玩游戏，但这不是我期待的未来。如果 AI 接管了娱乐，人却继续干活，那更像反乌托邦。更有意思的方向是：**让 AI 参与创造游戏，让人继续亲自玩。**

因此，Jev 在这里担任「导演」，不会替玩家操作。它读取当前战局，在有限的候选中判断下一间房、遭遇和奖励应该怎样安排；代码把选择变成可玩的内容；玩家自己探索、战斗、做选择并承担结果。Jev 的选择模型适合这个位置：它能理解玩家的上下文，又只能在游戏已经确认安全、可实现的选项中回答。希望每一局都像是为玩家而编排，同时把游玩的乐趣和主动权留给玩家。

## 核心理念

**参数由 Jev 决策，房间由算法生成。** 程序化 Roguelike 本来就有生成地图、编排敌人和选取奖励的算法，也有一层决定向这些算法输入什么参数的策略，通常写成权重表和 `if` 判断。启用 Jev 时，本项目把这层策略中表达**体验偏好**的部分交给 Jev，保留原有生成器。

Jev 同时参考玩家声明的风格和实际游玩表现：持有的法术与升级、近期战斗，以及领取或跳过的奖励。代码先筛出合法、公平且符合预算的候选，Jev 判断哪些更适合当前玩家，代码再按返回的概率抽样。例如，Jev 可以偏向 `open_arena`、不对称布局和偏暖的氛围；房间生成器才负责摆放具体地面与掩体、检查连通性和测量结果，必要时重试或使用保底房间。下一轮再针对已经生成的房间选择遭遇参数。Jev 不输出地块地图。

目标是让战局**回应玩家，但保留不确定性和挑战**：玩家的构筑可以发挥作用，却不会保证每间房都顺风或每次奖励都称心。数值平衡、安全边界、具体摆放和带种子的随机性仍由代码负责。这一分工分别写在[001：愿景与范围](docs/planning/001-vision-and-scope.md)、[002：Jev 集成原则](docs/planning/002-jev-integration-principles.md)和[004：房间生成](docs/planning/004-room-generation.md)。

## 核心架构

```text
战局与战斗数据
  → 汇总当前状态
  → 代码枚举并筛选合法选项
  → Jev 返回各选项的概率
  → 代码用固定种子的随机流抽样
  → 代码生成并校验可玩的结果
  → 固定步长模拟战斗；Phaser 负责呈现
```

| 模块 | 职责 |
|---|---|
| [`packages/core`](packages/core) | 纯 TypeScript 战斗模拟、房间与遭遇生成器、法术、战局状态、硬约束和带种子的随机数；不依赖 DOM 或 Phaser。 |
| [`packages/director`](packages/director) | 构造 Jev 的状态与问题，校验回答、抽样决策，并形成房间和奖励计划。 |
| [`packages/game`](packages/game) | Phaser 输入、渲染、音效、菜单和浏览器侧的 Jev 调用；不负责战斗规则。 |
| [`packages/harness`](packages/harness) | 复用同一套 core 的无界面测试、平衡性模拟、请求记录和资源检查。 |
| [`server/worker.ts`](server/worker.ts) | 无状态代理，在服务端加入 TypeSafe API key；浏览器包中没有这个 key。 |

模拟以固定的 60 Hz 步长运行。只有在规划房间或奖励时才询问 Jev，不会每帧调用。因此，同一个战局种子可以复现结果，无界面工具也能运行与游戏相同的战斗代码。

## Jev 在游戏里具体做什么

**Jev 决定偏好；代码负责生成和硬规则。** 代码先计算玩家现状、排除不可能的选项；Jev 返回剩余选项的概率分布；代码抽样，再校验最终计划。Jev 不摆放地块、不创造敌人或法术、不计算伤害，也不编写游戏内容。

一个战斗房间在开始时分两轮规划，出口打开时再问一次：

1. **整体方向：**战斗强度、房间空间、大小、对称性和氛围。
2. **房间形态确定之后：**区域与遭遇细节，例如敌人组合、密度、波次、入场方式、变体和精英。依赖第一轮结果的问题，要等第一轮结束后才构造。
3. **领取奖励之后：**决定出口的门，以及每种门背后那一房会给出的卡。门先以待定状态升起并旋转，Jev 回答后打开，标出门后卡牌涉及的所有法术系别或属性类别。门在这时才决定，读到的是刚打完的战斗和刚变化的构筑（[发现 34](docs/research/jev-findings.zh-CN.md#finding-34)）。

浏览器默认向 Jev 发送结构化的英文 **briefing**。其中包含游戏规则、玩家选定的风格、持有的法术与升级、近期战斗数据、领取或跳过的奖励、房间历史、当前生命与金币，以及本次要做的决定。它提供**中性事实**，例如“60 点生命损失了 9 点”，而不是“玩家陷入苦战”或“玩家缺蓝”这样的主观结论。否则，人写下的判断会在 Jev 回答前暗中决定方向。`?state=labels` 可以切换到紧凑的标签表，用于对照；规则表始终读取这些标签。

下面是一个真实问题结构的**缩写示例**。正式请求的 briefing 和选项描述更长。`criteria` 中的 ID 是代码提供的合法候选，因此 Jev 只能在其中回答：

```json
{
  "state": {
    "briefing": "The player: Barrage style. The build: three spell keys. Right now: 45 of 60 health, 38 gold, room 4 of 16. ..."
  },
  "questions": {
    "portal_need": {
      "type": "choice",
      "instructions": "Which reward does this player need most right now? ...",
      "criteria": {
        "spell": { "what": "A new spell or a level for one held.", "not_for": "Three full, raised keys." },
        "affix": { "what": "A modifier for a held spell.", "not_for": "No affix slots left." },
        "stat": { "what": "A permanent player upgrade.", "not_for": "An empty spell key remains empty." },
        "gold": { "what": "A purse to spend later.", "not_for": "Already enough to buy everything ahead." },
        "fallback": { "what": "None of these fits; let the game decide." }
      }
    }
  }
}
```

回答包含 `answers.portal_need.choice`、**每个**候选 ID 的概率，以及根据概率分布算出的置信度。例如 `spell: 0.55`、`affix: 0.20`、`stat: 0.15`、`gold: 0.08`、`fallback: 0.02`，总和为 1。游戏先校验分布、移除退出选项。对于只选一个答案的问题，按 TypeSafe 文档的方式读取：置信度不低于 0.5 时采用 Jev 的 `choice`，低于 0.5 时按 Jev 给出的原始分布、用种子抽样，因此一局的变化来自 Jev 自己的犹豫（[发现 33](docs/research/jev-findings.zh-CN.md#finding-33)）。`portal_need` 这类排序问题用种子抽样：第一扇门更集中，后续的门从更分散的分布中抽出且互不相同。Jev 拒答、超时或回答无效时，受影响的决策交给规则表。均匀随机是独立的实验基线，不用于故障回退。

完整的请求与响应格式、决策时序、校验、抽样和回退流程见[架构详解中文版](docs/architecture.zh-CN.md)（[English](docs/architecture.md) · [日本語](docs/architecture.ja.md)）。实际试跑数据与设计调整见 [Jev findings](docs/research/jev-findings.zh-CN.md)。

### 在游戏里查看一次决策

点击右上角 **DEBUG** 按钮（或按反引号键），进入 **DIRECTOR** 标签。展开 **state as sent** 和 **questions as sent**，就能查看一次由 Jev 回答的请求所发送的完整 briefing、指令和候选项。侧栏还会显示规划时使用的概率分布、抽到的选项、回答来源及回退状态、耗时和 token 用量。如果请求改由规则版回答，来源会明确标出，显示的状态也是规则版实际读取的状态。

## 本地运行

规则版 Director 不需要 API key：

```sh
pnpm install
pnpm dev
```

要在本地使用 Jev Director，把自己的 TypeSafe key 写入被 Git 忽略的 `.env.local`，启动开发服务器，再从标题菜单打开 **Jev Director**：

```sh
echo 'TYPESAFE_API_KEY=...' >> .env.local
pnpm dev
```

本地 Vite 通过 `/api/decide` 提供无状态代理，key 不会进入客户端代码。默认使用规则版 Director；`?director=jev` 和 `?director=random` 可指定其他版本，`?seed=...` 可固定种子以复现战局。

## 对比记录与验证

### 可迁移到其他 Jev 项目的发现

以下九条来自 [Jev findings 完整记录](docs/research/jev-findings.zh-CN.md)，适用于这个游戏之外的决策场景：

1. [为每个问题提供“都不符合”选项（发现 0）](docs/research/jev-findings.zh-CN.md#finding-0)。即使所有候选项都不适用，Jev 仍会在它们之间分配概率。显式的退出选项能让调用方识别这种情况并使用回退逻辑；概率集中不等于选项适用。本项目中，第一间房涉及“上一间房”的问题因缺少历史而全部拒答。
2. [给 Jev 中性观测值，不给主观结论（发现 16）](docs/research/jev-findings.zh-CN.md#finding-16)。state 应报告实测事实和预先算好的计数，不替 Jev 论证答案。将 briefing 中带强调的判断改为平实事实后，连未直接修改的问题也变了：`mood_particles: calm` 从 91% 降到 72%，`stat_family: survival` 从 75% 降到 42%。共享 state 的表述一改，就要重新检查所有问题。
3. [用代码约束跨多次决策的行为，除非 state 已写出这段历史（发现 5、32）](docs/research/jev-findings.zh-CN.md#finding-32)。无状态分类看不到自己的连续重复：同类门最长连续次数在有代码上限时为 5，去掉上限为 7，在提示词里要求多样性后达到 10。当 briefing 写出每一房实际生成的样子之后，在 instruction 里加一句中立的原则——指明历史在 state 的哪里，并说明没有历史时它不起作用——就让上一个法术系别的概率从 0.87 降到 0.46；同样的意思写得笼统，则连第一房都会把答案推离玩家风格。把 Jev 自己之前的回答列给它，反而让重复更严重（[发现 31](docs/research/jev-findings.zh-CN.md#finding-31)）。
4. [强调式叙述会抬高它反复提到的选项，中性计数不会（发现 5a）](docs/research/jev-findings.zh-CN.md#finding-5a)。固定同一个 state、只改一句话：什么都不加时 `affix` 为 3%；加上“玩家说想要更多 affix”后为 78%；加上“过去 4 个房间里玩家每次都选 spell 或 stat 门，从没选过 affix 门”这句讲“回避”的话后，反而升到 44%。同样的历史写成平实计数（“过去 4 个房间选的门：spell 2、stat 2”）则仍是 3%。玩家亲口表达的意愿（包括否定）会被准确理解；而“每次”“从不”“总是”这类强调词，以及围绕某个选项展开的句子，都会变成替该选项说话。
5. [计数要按选项提问的方向来写（发现 30）](docs/research/jev-findings.zh-CN.md#finding-30)。Jev 不做算术。选项问的是最近几张牌有几张*偏离*玩家风格，state 却写成“符合所选风格：0/3”，结果偏离越多，Jev 反而越倾向“保持风格”的答案。改成“偏离所选风格：N/3”，并让每个选项以对应数值的这一行作为示例后，回答几乎变成查表（0/3 → `low` 1.00；2/3 或 3/3 → `high` 0.58–1.00）。
6. [只在选项区别在于“哪条事实成立”时才用示例（发现 3）](docs/research/jev-findings.zh-CN.md#finding-3)。选项之间的区别在于“它们是什么”时，示例是噪音，容易过拟合；区别只在于某一行 state 取哪个值时，示例才是 Jev 学会对应关系的途径。某个问题只删掉两个示例、其余不变，答案就从一个选项 56% 变成另一个选项 99%。
7. [措辞改动用已记录请求做 A/B 测量（发现 28）](docs/research/jev-findings.zh-CN.md#finding-28)。重放同一批记录下来的 state，只替换改动的那句话。拿两次实际对局比较，会把措辞和不同的种子、敌人组合、玩家行为混在一起；本项目里就有两个看似是 Director 的问题，最后查明是脚本化测试玩家造成的（发现 29、30）。
8. [按置信度读取 Choice（发现 33）](docs/research/jev-findings.zh-CN.md#finding-33)。低于 1 的抽样温度会把 Jev 的第二选项读得比它说的更弱。置信时取 `choice`、不置信时按原始分布抽样，整体效果与逐题调好的温度相当，不需要为每题设数值，而且让我们要求的“犹豫”真的改变了答案。
9. [先决定内容，再从内容读出标签（发现 34）](docs/research/jev-findings.zh-CN.md#finding-34)。单独决定的“法术门承诺某个系别”，只要 Jev 的偏好稳定就会一直重复（10 扇门全是雷电）。改为先定卡、门上标出其中所有系别后，风格贴合度基本不变（67% 对 69%），一局见到的系别从 4.3 种增加到 7 种里的 5.3 种。

### 本游戏的 Jev 与 rule 对比

2026-10-07 用当前的 Director（奖励卡逐张判断，发现 35）重新测量：**相同的 10 个种子**、expert 参考玩家、briefing 格式，每种风格两名玩家，每人都输入了一句话（`route-review` 的玩家设定）。下表统计 **Director 生成的奖励选项中，符合风格的法术卡牌占比**；Jev / rule 表示两种奖励来源。

| 风格 ID | Director 提供的符合风格法术，Jev / rule |
|---|---:|
| `spam` | 56% / 39% |
| `nuke` | 65% / 48% |
| `area` | 74% / 48% |
| `dot` | 57% / 40% |
| `melee` | 77% / 54% |

五种风格中，Jev 生成的奖励所展示的**法术**卡牌都更贴合风格。每局出现的不同法术 Jev 平均 11.9 种、rule 14.4 种，风格更集中仍会缩窄法术池，但比逐张判断之前（发现 30 的 9.7 对 13.6）差距变小了。到达 Boss 的次数是 Jev 8/10、rule 5/10；每边只有 10 局，只能算趋势，不能断言 Jev 有生存优势。rule 完全不读玩家输入的那句话。

**玩家视角的结论：**现有数据支持“法术奖励更贴合所选风格”，尚不能证明“更好玩”或“更想重玩”。目前没有已完成的 Jev 与 rule 真人盲测结果。[011：遥测与评估](docs/planning/011-telemetry-and-evaluation.md)规划了玩家需要回答的两个问题：哪局更像为自己安排，以及哪局更想再玩。

```sh
pnpm verify          # 类型检查、测试、资源、内容、音频、法术和平衡性检查
pnpm build           # 生产构建
pnpm route-review rule 3
```

`pnpm verify` 不需要 API key，也不会调用在线模型。更多设计背景见[愿景与范围](docs/planning/001-vision-and-scope.md)、[Jev 集成原则](docs/planning/002-jev-integration-principles.md)和[技术架构](docs/planning/009-technical-architecture.md)。[规划文档索引](docs/planning/README.md)列出其他章节；[美术素材说明](assets/source/README.md)介绍美术管线。
