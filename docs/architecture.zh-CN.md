# Jev 如何导演一局游戏

[English](architecture.md) · **简体中文** · [日本語](architecture.ja.md)

本文说明目前**已经实现**的决策流程。设计依据见[002：Jev 集成原则](planning/002-jev-integration-principles.md)，整体系统见[009：技术架构](planning/009-technical-architecture.md)。问题设计背后的实测结果与失败尝试记录在 [Jev findings](research/jev-findings.zh-CN.md)。

## 职责边界

Jev 是**选择模型**，不是关卡生成器，也不运行游戏循环。游戏给它当前战局的描述和一组有名字的合法选项；Jev 返回这些选项的概率分布；代码再从分布中抽样、生成结果。

```text
战局状态和战斗测量
  → 汇总战局，构造 briefing
  → 代码枚举并筛选合法选项
  → 向 Jev 提交一个或多个相互独立的选择题
  → 校验并调整返回的概率分布
  → 用带种子的随机流抽样
  → 生成房间、遭遇、门或卡牌
  → 按游戏规则校验最终计划
```

这样的分工保留了 Roguelike 的程序生成器。Jev 决定什么样的房间、压力、遭遇、奖励或卡牌展示适合当前战局；它不摆放地块、不发明敌人、不编写卡牌、不计算伤害，也不越过硬约束。同一条流程可以用 Jev、规则表或均匀随机作为概率来源（[`source.ts`](../packages/director/src/source.ts)、[`director.ts`](../packages/director/src/director.ts)）。因此规则版既是对照组，也是 Jev 无法回答时的回退来源。

| 层 | 负责人 | 示例 |
|---|---|---|
| 事实与约束 | `packages/core` 和 `packages/director` | 当前生命、持有法术、合法房间形态、遭遇预算、节奏上限 |
| 偏好 | Jev、规则表或随机来源 | `spell`、`affix`、`stat`、`gold` 各类门的概率 |
| 结果生成 | `packages/core` 和 `packages/director` | 带种子的抽样、房间布局、敌人编组、卡牌选择、最终校验 |
| 游玩与呈现 | `packages/core` 和 `packages/game` | 固定步长模拟、Phaser 输入与渲染 |

## 何时做决定

Director 在房间边界规划，而不是每帧调用。战斗房间开始时分两轮：第一轮决定战斗强度、空间类型、大小、对称性和氛围等整体属性；第二轮读取第一轮形成的房间，再决定遭遇与区域细节，例如敌人组合、密度、波次、核心敌人、入场方式、变体和精英。这一房的卡在玩家选门时就已定好，所以两轮都不再问卡（第一房除外）。出口打开时——领取奖励、金币房撒出金币、进入商人等房间——门先以待定状态升起，再用一次请求决定门，以及每种门背后那一房会给出的卡。每扇门保留自己那类卡，并标出其中所有法术系别或属性类别（[发现 34](research/jev-findings.zh-CN.md#finding-34)）。具体有哪些问题，取决于当时还剩哪些合法选项（[`questions/room.ts`](../packages/director/src/questions/room.ts)、[`director.ts`](../packages/director/src/director.ts)）。

同一次请求里的问题彼此独立。代码不会要求 Jev 让其中一个回答以同次请求的另一个回答为条件。如果后续选择依赖先前选择，就等上一轮结束再构造：房间形态确定后才问遭遇。能合并时，代码会把预备性的问题一起问——门的请求会问每种可能的门背后的卡，再只取选中的门需要的那几组。

## Jev 收到什么

浏览器默认发送一个 `briefing` 字符串：它用结构化的自然语言描述游戏、玩家风格、当前构筑、近期战斗测量、奖励历史、战局历史、现有资源和本次决策（[`briefing.ts`](../packages/director/src/briefing.ts)）。测量值被表达为**事实**，而不是“玩家很弱”之类的结论；判断留给 Jev。briefing 中的术语解释和数值来自游戏常量。对照用的 `labels` 格式则发送简短的语义标签表，选项描述中带有匹配条件。在浏览器里，`?state=labels` 可切换为该格式；即使 Jev 读取 briefing，规则表仍读取结构化标签。

下面是一个真实 `portal_need` 请求结构的**缩写示例**。正式 briefing 长得多，选项文字也已缩短；字段名和值类型与当前构造器一致。示例不包含凭据或传输头。

```json
{
  "state": {
    "briefing": "The game\n- A top-down action roguelike...\nThe player\n- Style: Barrage (spam)\nThe build\n- Three spell keys...\nWhat the last fights measured\n- ...\nRight now\n- Health: 45 of 60...\n- Gold: 38...\n- Room 4 of 16\nDeciding in this request\n- ..."
  },
  "questions": {
    "portal_need": {
      "type": "choice",
      "instructions": "Which reward does this player need most right now? One option per portal badge; the highest answers become the portals out of this room, in that order. ...",
      "criteria": {
        "spell": {
          "what": "A new spell fills an empty key; a copy of one held raises its level.",
          "not_for": "A staff whose three keys are full and raised."
        },
        "affix": {
          "what": "A modifier attaches to a held spell or raises a duplicate's tier.",
          "not_for": "A staff with no affix slot left anywhere."
        },
        "stat": {
          "what": "A permanent player upgrade to movement, survival, mana, or sword.",
          "not_for": "A run with an empty spell key that this card would leave empty."
        },
        "gold": {
          "what": "A purse to spend later at the merchant or smith.",
          "not_for": "A player who already carries more than the stop can cost."
        },
        "fallback": {
          "what": "None of these fits; let the game decide."
        }
      }
    }
  }
}
```

每道题都有 `type: "choice"`、`instructions`，以及把**选项 ID** 映射到描述的 `criteria`。默认的 briefing 格式用对象描述选项：`what`、通常还有 `not_for`，少数选项带 `examples`；标签格式改用描述字符串。每道题都有 `fallback` 退出选项，它不是门，也不是其他游戏内结果。代码在构造问题前就已过滤选项，因此不会让 Jev 选择不可能的奖励或违规的房间参数（[`questions/common.ts`](../packages/director/src/questions/common.ts)）。

代理在服务端加入配置好的模型与 API key，再把请求转发到 TypeSafe 的 System One 接口。浏览器只接触项目自己的代理地址和返回结果（[`evaluator.ts`](../packages/director/src/evaluator.ts)、[`worker.ts`](../server/worker.ts)）。

## 返回什么，以及游戏如何使用

下面的响应是**说明格式的示例**；概率用于展示协议，并非某次在线试跑的原始回答：

```json
{
  "model": "jev-latest",
  "answers": {
    "portal_need": {
      "type": "choice",
      "choice": "spell",
      "probabilities": {
        "spell": 0.55,
        "affix": 0.20,
        "stat": 0.15,
        "gold": 0.08,
        "fallback": 0.02
      },
      "confidence": 0.91
    }
  },
  "usage": { "input_tokens": 1234 }
}
```

调用器检查每道题都有回答、`choice` 属于提供的 ID、概率键与选项完全对应，且数值构成有效分布（[`evaluator.ts`](../packages/director/src/evaluator.ts)）。如果 Jev 选中 `fallback`，或给它超过一半的概率，只有这道题交给规则表。否则，代码移除 `fallback`、重新归一化其余概率，并执行该决策专用的调整（例如对重复上一房外观的惩罚）。只选一个答案的问题按 TypeSafe 文档读取 Choice 的方式处理：置信度不低于 0.5 时采用 Jev 的 `choice`，低于时用战局种子导出的确定性随机流，按 Jev 的原始分布抽样（[发现 33](research/jev-findings.zh-CN.md#finding-33)）。排序类问题用抽样：`portal_need` 的第一扇门从较集中的分布抽取，其余不同的门从较宽的分布抽取；卡牌从 Jev 的综合排序中抽取。规则表与随机两个对照组使用逐题的温度抽样（[`source.ts`](../packages/director/src/source.ts)、[`director.ts`](../packages/director/src/director.ts)）。

最终计划仍须通过代码校验。遭遇压力、可用资源、合法门集合等硬约束不会交给提示词保证。超时、HTTP 错误、响应格式错误、拒答或最终计划校验失败都会记录回退原因，并由**规则版**回答，而非均匀随机。请求期限、有限重试和响应校验由调用器管理；追踪记录保存状态、问题、分布、回答来源与最终决策（[`trace.ts`](../packages/director/src/trace.ts)、[011：遥测](planning/011-telemetry-and-evaluation.md)）。

运行游戏时，点击右上角 **DEBUG** 按钮（或按反引号键），再打开 **DIRECTOR** 标签。展开 **state as sent** 与 **questions as sent**，可以查看由 Jev 回答的请求全文。侧栏还展示规划使用的概率分布、抽样结果、来源与回退状态、耗时和 token 用量。若改由规则版回答，侧栏显示的是规则版读取的状态。

## 为什么问题这样设计

Jev 判断当前状态和提供的选项，不保存跨请求的战局记忆。因此代码先把战局写下来：近期每一房实际生成的样子——战斗如何组成、每扇出口门背后是什么——玩家拿走或跳过的内容、近期战斗和当前构筑。给出的是房间实际的样子，而不是 Director 自己之前的回答列表，后者会被 Jev 当作应当延续的先例（[发现 31](research/jev-findings.zh-CN.md#finding-31)）。Jev 无法应对的序列性质（例如同类门重复出现的上限）仍由代码执行；当 state 已写出这段历史时，可以在 instruction 里用一句原则请 Jev 参考它（[发现 32](research/jev-findings.zh-CN.md#finding-32)）。

项目用两种基线检验效果。`rule` 在相同合法选项和生成器上使用手写权重；`random` 使用均匀权重，忽略状态。无界面模拟与请求追踪让我们比较所生成的房间和完整战局。具体实验，包括有些措辞反而让决策变差的例子，见 [Jev findings](research/jev-findings.zh-CN.md)。
