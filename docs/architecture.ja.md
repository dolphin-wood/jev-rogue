# Jev がランを演出する仕組み

[English](architecture.md) · [简体中文](architecture.zh-CN.md) · **日本語**

この文書は**実装済み**の判断経路を説明します。設計上の理由は[002: Jev 統合の原則](planning/002-jev-integration-principles.md)、システム全体は[009: 技術アーキテクチャ](planning/009-technical-architecture.md)を参照してください。質問の形を決めた実測と失敗例は [Jev findings](research/jev-findings.md)に記録しています。

## 役割の境界

Jev は**選択モデル**であり、レベル生成器やゲームループではありません。ゲームが現在のランと名前付きの合法な選択肢を渡し、Jev がそれらの確率分布を返します。コードがその分布から抽選し、結果を生成します。

```text
ランの状態と戦闘計測
  → ランを要約して briefing を組み立てる
  → コードが合法な選択肢を列挙・絞り込む
  → 独立した選択問題を一つ以上 Jev に尋ねる
  → 返された分布を検証・調整する
  → シード付き乱数で抽選する
  → 部屋、敵との遭遇、扉、カードを生成する
  → 完成したプランをゲームのルールで検証する
```

この分担により、ローグライクの手続き生成は残ります。Jev は現在のランに合う部屋、強度、敵との遭遇、報酬、提示内容の**種類**を判断します。タイルの配置、敵の発明、カード文章の作成、ダメージ計算、厳守すべき制約の解除はしません。同じ処理系は Jev、ルールテーブル、一様乱数のいずれも確率の供給源として使えます（[`source.ts`](../packages/director/src/source.ts)、[`director.ts`](../packages/director/src/director.ts)）。そのため rule モードは対照群であり、Jev が答えられない場合の代替でもあります。

| 層 | 担当 | 例 |
|---|---|---|
| 事実と制約 | `packages/core` と `packages/director` | 現在の体力、所持呪文、合法な部屋の形、敵編成の予算、進行ペースの上限 |
| 選択肢への好み | Jev、ルールテーブル、乱数 | `spell`、`affix`、`stat`、`gold` の扉に与える確率 |
| 結果の実現 | `packages/core` と `packages/director` | シード付き抽選、部屋の配置、敵編成、カード選択、最終検証 |
| プレイと表示 | `packages/core` と `packages/game` | 固定ステップのシミュレーション、Phaser の入力と描画 |

## いつ判断するか

Director は部屋の境目でプランを立て、毎フレームは呼び出しません。戦闘部屋は開始時に二段階で計画します。第一段階で戦闘の強度、空間、広さ、対称性、雰囲気などの大枠を選び、第二段階は第一段階で決まった部屋を読んで、構成、密度、ウェーブ、主な敵、登場方法、バリエーション、エリートの有無など敵編成とゾーンの詳細を選びます。その部屋のカードはプレイヤーが通った扉と一緒に決まっているため、どちらの段階でも尋ねません（最初の部屋を除く）。出口が開くとき——報酬を受け取る、金貨部屋でコインが散る、商人などの部屋に入る——扉は未確定のまま現れ、一度のリクエストで扉と、扉の種類ごとにその先の部屋が出すカードを決めます。各扉は自分の種類のカードを持ち、その中のすべての呪文系統またはステータス系統を表示します（[発見 34](research/jev-findings.md#finding-34)）。質問の具体的な組み合わせは、その時点で残る合法な候補によって変わります（[`questions/room.ts`](../packages/director/src/questions/room.ts)、[`director.ts`](../packages/director/src/director.ts)）。

一つのリクエスト内の質問は互いに独立しています。同じリクエストの別の回答を条件にして答えるよう Jev に求めることはありません。後の選択が先の結果に依存する場合は、前の段階を終えてから質問を組み立てます。部屋の形が決まってから敵編成を尋ねるのがその例です。まとめられる場合は投機的な質問を一緒に尋ねます。扉のリクエストでは、扉がなりうる種類すべてのカードを尋ね、選ばれた扉に必要なものだけを使います。

## Jev が受け取るもの

ブラウザーの既定の状態形式は、一つの `briefing` 文字列です。ゲームの仕組み、プレイヤーのスタイル、現在のビルド、直近の戦闘計測、報酬とランの履歴、現在の資源、今回の判断を、構造化した自然言語で記します（[`briefing.ts`](../packages/director/src/briefing.ts)）。体力の減少量や所持品などの**事実**を述べ、「苦戦している」といった結論は Jev に委ねます。用語の説明や数値はゲームの定数に基づきます。比較用の `labels` 形式では簡潔な意味ラベルの表を送り、選択肢の説明には照合条件を付けます。ブラウザーで `?state=labels` を指定すると切り替わります。Jev が briefing を読む場合でも、ルールテーブルは構造化されたラベルを読みます。

次は実際の `portal_need` リクエスト形式を**短縮した例**です。本番の briefing はさらに長く、選択肢の説明も省略しています。キーと値の型は現在の実装に合わせています。認証情報や通信ヘッダーは含みません。

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

各質問には `type: "choice"`、`instructions`、そして**選択肢 ID** を説明に対応付ける `criteria` があります。既定の briefing 形式では、選択肢の仕様を `what`、通常は `not_for`、必要な場合のみ `examples` を持つオブジェクトで示します。ラベル形式では説明文の文字列を使います。すべての質問に退避用の `fallback` が含まれますが、これは扉などのゲーム内の結果ではありません。コードは質問を作る前に候補を絞るため、不可能な報酬や違反する部屋の設定は Jev に渡りません（[`questions/common.ts`](../packages/director/src/questions/common.ts)）。

プロキシは設定されたモデルと API キーをサーバー側で追加し、TypeSafe の System One エンドポイントへ転送します。ブラウザーが扱うのは、このプロジェクトのプロキシ URL と応答だけです（[`evaluator.ts`](../packages/director/src/evaluator.ts)、[`worker.ts`](../server/worker.ts)）。

## 応答と、その使い方

次の応答は**形式を示す例**です。確率は実際のランから採ったものではありません。

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

評価器はすべての質問に回答があること、`choice` が提示した ID に含まれること、確率のキーが選択肢と一致すること、値が有効な分布を作ることを確認します（[`evaluator.ts`](../packages/director/src/evaluator.ts)）。Jev が `fallback` を選ぶか、そこに半分を超える確率を付けた場合、その質問だけをルールテーブルに任せます。それ以外では、コードが `fallback` を除いて残りを再正規化し、前の部屋の見た目を繰り返すことへのペナルティなど、判断ごとの調整を行います。答えが一つの質問は TypeSafe のドキュメントどおりに読みます。信頼度が 0.5 以上なら Jev の `choice` を採用し、それ未満ならランのシードから得た決定的な乱数で Jev の分布をそのまま抽選します（[発見 33](research/jev-findings.md#finding-33)）。順位付けは抽選です。`portal_need` は最初の扉をより絞った分布から、後続の異なる扉をより広い分布から選び、カードは Jev の総合順位から抽選します。ルールとランダムの対照群は質問ごとの温度で抽選します（[`source.ts`](../packages/director/src/source.ts)、[`director.ts`](../packages/director/src/director.ts)）。

完成したプランもコードによる検証を通ります。敵編成の強度、利用可能な資源、合法な扉の集合といった制約を、プロンプトだけで守らせることはありません。タイムアウト、HTTP エラー、不正な応答、辞退、完成時の検証失敗は代替理由として記録し、**ルール版**が回答します。一様乱数には切り替えません。期限、回数を限った再試行、応答の検証は評価器が扱います。トレースには状態、質問、分布、判断元、最終的な選択を残します（[`trace.ts`](../packages/director/src/trace.ts)、[011: テレメトリー](planning/011-telemetry-and-evaluation.md)）。

ゲーム中は右上の **DEBUG** ボタンを押すかバッククォートキーを押し、**DIRECTOR** タブを開きます。**state as sent** と **questions as sent** を展開すると、Jev が回答したリクエストの全文を確認できます。同じパネルに、計画で使った確率分布、抽選結果、回答元とフォールバック、所要時間、トークン数も表示されます。rule モードが回答した場合は、そのモードが読んだ状態を表示します。

## 質問がこの形になった理由

Jev は現在の状態と提示された選択肢を判断します。リクエストをまたぐランの記憶は持ちません。そのためコードが事前にランを書き出します。直近の各部屋が実際にどう生成されたか（戦闘の構成、各出口の扉の先にあったもの）、プレイヤーが取ったものと見送ったもの、直近の戦闘、現在のビルドです。Director 自身の過去の回答の一覧ではなく実際の部屋を渡します。回答の一覧は、Jev に守るべき先例として読まれるためです（[発見 31](research/jev-findings.md#finding-31)）。同じ種類の扉を連続で出す上限など、Jev が応えない連続性の性質はコードが守ります。state が履歴を書いている場合は、instruction の原則で Jev にそれを考慮させることもできます（[発見 32](research/jev-findings.md#finding-32)）。

効果は二つのベースラインと比較します。`rule` は同じ合法な候補と生成器に対して手書きの重みを使い、`random` は状態を無視して一様な重みを使います。ヘッドレスのシミュレーションとリクエストのトレースで、部屋やラン全体を比較できます。言い回しを変えて判断がかえって悪化した例も含め、具体的な実験は [Jev findings](research/jev-findings.md)にあります。
