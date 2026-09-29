/**
 * 日本語 content: names and descriptions keyed by the id `core` uses.
 *
 * Core keeps its English — the harness reads it, the tests match it, and it
 * is what the Director is sent — so this is a lookup beside it rather than a
 * replacement for it. An id missing here falls back to core's English.
 *
 * Spell names are katakana where the English is a coined compound and kanji
 * where the idea has a settled Japanese word, which is the split the genre
 * uses; whichever a spell gets, it keeps on every screen.
 */
import type { ContentTable } from "./index.ts";

export const JA_CONTENT: ContentTable = {
  /* -------------------------------- attacks ------------------------------ */
  magic_bolt: { name: "マジックボルト", description: "一番安く撃てる単発の弾。出が速い。" },
  shock_arc: { name: "ショックアーク", description: "当たった敵から、近くの敵へ最大2回跳ぶ電撃。跳ぶたびに威力は半減する。" },
  spark_spray: { name: "スパークスプレー", description: "目の前に火花を扇状にばらまく。" },
  stone_shard: { name: "ストーンシャード", description: "石つぶてを投げる。単発の威力はコモンの攻撃呪文で最強。" },
  earth_spikes: { name: "アースパイク", description: "一直線に石の棘を次々と突き上げ、刺さった敵をよろめかせる。敵が一列に並んだときに強い。" },
  flame_pillars: { name: "フレイムピラー", description: "一直線に火柱を次々と立て、通った床をしばらく燃やす。" },
  cinder_geysers: { name: "シンダーガイザー", description: "狙った敵の足元とその周りから、炎を次々と噴き上げる。群れに強い。" },
  ember_dart: { name: "エンバーダート", description: "当たった敵を燃やす。" },
  frost_needle: { name: "フロストニードル", description: "当たった敵を冷気で鈍らせる。" },
  venom_spit: { name: "ヴェノムスピット", description: "当たると毒が重なる。速く撃つほど毒が溜まる。" },
  arc_lance: { name: "アークランス", description: "敵を貫く、速い雷の槍を投げる。" },
  scatter_shot: { name: "スキャッターショット", description: "至近距離で弾をばらまく。近いほど多く当たる。" },
  cinder_burst: { name: "シンダーバースト", description: "燃える火種を2つ撃つ。マナは重め。" },
  glacier_spike: { name: "グレイシャースパイク", description: "巨大な氷柱を突き出し、当たった敵を鈍らせる。" },
  void_orb: { name: "ヴォイドオーブ", description: "重くゆっくり進み、触れたものを通り抜けて弾き飛ばす。クールダウンが長い。" },
  plague_bloom: { name: "プレイグブルーム", description: "触れると毒になる胞子をまく。" },
  spirit_blades: { name: "スピリットブレード", description: "3枚の刃が体の周りを回り、触れたものを斬り続ける。再詠唱すると刃は張り直され、重ならない。" },
  wildfire_field: { name: "ワイルドファイア", description: "一番近い敵の足元に火を放つ。火が消えるまで、踏み込んだ敵は燃える。" },
  blink_strike: { name: "ブリンクストライク", description: "前へ瞬間移動し、道中の敵を一太刀ずつ斬る。移動中は無敵。" },
  void_maw: { name: "ヴォイドマウ", description: "一番近い敵の足元に渦を開き、数秒間まわりの敵を中心へ引き寄せながらダメージを与える。" },
  spirit_ally: { name: "スピリットアライ", description: "後ろをついてくる霊を呼ぶ。しばらく一番近い敵を自動で撃つ。" },
  frost_nova: { name: "フロストノヴァ", description: "自分を中心に氷の刃を広げ、近くの敵を凍らせる。近くの敵にしか当たらない。" },
  seeker_swarm: { name: "シーカースウォーム", description: "自分で敵を追う矢の群れを放つ。必中だが、単体相手には割高。" },
  fault_line: { name: "フォルトライン", description: "一直線を貫く石の刃を押し出す。" },
  stone_ward: { name: "ストーンウォード", description: "目の前に石柱を立て、そばの敵を押しのけて傷つける。壊れるまで敵も弾も止める。" },
  mana_darts: { name: "マナダーツ", description: "キーを離している間にダーツを1本ずつ溜める（最大5本）。押すと溜めたダーツを扇状に一斉に放ち、前の敵を追う。" },
  arcane_cannon: { name: "アーケインキャノン", description: "押し続けて溜め、離して撃つ。敵を貫く砲弾は溜めるほど大きくなり、最大まで溜めると敵がよろめく。溜め中は動きが遅く、ダッシュで溜めを取り消せる（マナは減らない）。" },
  doom_sigil: { name: "ドゥームシジル", description: "当たった敵に印を刻む。数秒後に印が炸裂し、その敵とそばの敵を傷つける。炸裂するまで、同じ敵に印は重ならない。" },
  frozen_orb: { name: "フローズンオーブ", description: "ゆっくり進む氷の球を放つ。敵を通り抜けながら周りに氷片をまき、最後は氷片の輪になって弾ける。" },
  contagion: { name: "コンテイジョン", description: "濃い毒の塊を撃つ。毒に侵された敵が倒れると、毒が近くの数体に移り、そこからさらに広がる。" },
  meteor: { name: "メテオ", description: "狙った敵の足元に落下地点を示し、少しして燃える岩が落ちて床を燃やす。敵は印の外へ逃げられる。" },
  quake_ring: { name: "クエイクリング", description: "自分を中心に、地面を輪状に次々と砕く。当たった敵はよろめく。" },
  leap_slam: { name: "リープスラム", description: "狙った敵へ跳びかかり（空中は無敵）、着地点のまわりの地面を輪状に砕く。" },
  ball_lightning: { name: "ボールライトニング", description: "手元からゆっくり漂う雷球を放ち、届く範囲でいちばん近い敵を毎秒数回撃つ。いくつか同時に出せ、新しい球はいちばん古い球と入れ替わる。" },
  returning_edge: { name: "リターニングエッジ", description: "霊体の剣を前へ投げる。剣は減速して折り返し、今いる場所へ戻ってくる。行きと帰りでそれぞれ一度ずつ敵を斬る。" },
  crescent_edge: { name: "クレセントエッジ", description: "しばらくの間、剣を振るたびに（当たっても外れても）三日月の剣気が前へ飛び、届く範囲の敵をすべて貫く。当たると怒りも少し溜まる。もう一度唱えると効果時間が戻る。" },
  counter_stance: { name: "カウンタースタンス", description: "短い構えを取る。動きが遅くなり、剣は振れない。次に当たるはずの攻撃を打ち消し、回転斬りで反撃して敵をよろめかせる。何も当たらなければ、構えが解けるときに弱い回転斬りを放つ。" },
  dash_slash: { name: "ダッシュ斬り", description: "剣を前に構えて突進し、通り道の敵を一太刀ずつ斬る。突進の両側に剣気が順に広がり、触れた敵を斬る。突進中は無敵。" },
  cinder_stride: { name: "シンダーストライド", description: "数秒間、歩いた後の床に火がつく。歩くたびに一か所ずつ燃え、立ち止まっている間は何も残らない。自分の火で焼けることはない。" },
  toxic_cloud: { name: "トキシッククラウド", description: "いちばん近い敵の足元に毒の霧を広げ、中にいる敵を毒で侵して足を遅くする。" },

  /* -------------------------------- affixes ------------------------------ */
  fork: { name: "フォーク", description: "当たると破片に分かれ、前へ飛び続ける。" },
  chain: { name: "チェイン", description: "当たると近くの次の敵へ、威力の落ちた同じ呪文を放つ。" },
  brand: { name: "ブランド", description: "1発目で印を付け、2発目で起爆する。" },
  harvest: { name: "ハーヴェスト", description: "この呪文で倒した敵がはじけ飛ぶ。" },
  bloom: { name: "ブルーム", description: "弾が飛び切った場所の床が燃え、上にいる敵を燃やす。外れても効果がある。" },
  shatter: { name: "シャッター", description: "壁や障害物に当たっても破片が飛ぶ。" },
  repeat: { name: "リピート", description: "押してから一拍おいて、そのとき狙っている方向へもう1回撃つ。" },
  scatter: { name: "スキャッター", description: "前だけでなく周りにも撃ち出す。" },
  ward: { name: "ワード", description: "詠唱すると、足元に敵の弾を防ぐルーンを残す。" },
  retort: { name: "リベンジ", description: "ダメージを受けると、攻撃してきた敵へこの呪文を撃ち返す（マナ消費なし）。" },
  slipstream: { name: "スリップストリーム", description: "ダッシュで敵をすり抜けるとき、ついでに攻撃する。" },
  pierce: { name: "ピアース", description: "弾が敵を貫いて飛び続ける。" },
  seek: { name: "シーク", description: "弾が一番近い敵へ曲がる。" },
  ricochet: { name: "リコシェ", description: "弾が壁で跳ね返り、部屋に戻ってくる。" },
  kindle: { name: "キンドル", description: "元の属性はそのままに、当てると燃焼も溜まる。もともと炎の呪文なら燃え上がりが速くなる。異なる属性を二つ抱えた敵は、受けるダメージがすべて増える。" },
  rime: { name: "ライム", description: "元の属性はそのままに、当てると凍結も溜まる。凍った敵を砕くと3倍ダメージ。異なる属性を二つ抱えた敵は、受けるダメージがすべて増える。" },
  blight: { name: "ブライト", description: "元の属性はそのままに、当てると毒も溜まる。毒は敵を鈍らせ、削っていく。異なる属性を二つ抱えた敵は、受けるダメージがすべて増える。" },
  haste: { name: "ヘイスト", description: "この呪文で倒すと、クールダウンが早く戻る。" },
  resonance: { name: "レゾナンス", description: "剣が何回か当たるたびに、斬った敵へこの呪文を放つ（マナ消費なし）。" },
  momentum: { name: "モメンタム", description: "ダッシュで敵を斬り抜けるたび、さらに少し先まで突き進む。最大3回。" },
  undertow: { name: "アンダートウ", description: "ダッシュの両側の剣気が敵を弾き飛ばさず、進路へ引き寄せる。ダッシュ自体は敵を少し前へ押すだけになる。" },
  finale: { name: "フィナーレ", description: "ダッシュの終わりに、前方へ三日月の剣気を放ち、届く範囲の敵をすべて貫く。" },
  repulse: { name: "リパルス", description: "詠唱すると近くの敵を一歩弾き飛ばし、次の詠唱の間合いを作る。" },
  parting: { name: "パーティングショット", description: "ダッシュするたび、ダッシュの起点から一番近い敵へこの呪文をマナなしで詠唱する。" },
  aftershock: { name: "アフターショック", description: "詠唱の少し後、一番近い敵の足元が爆ぜて周りの敵にも当たる。威力は詠唱に使ったマナで決まる。" },
  whirl: { name: "ワール", description: "回転斬りの始まりに、近くの敵最大3体へこの呪文をマナなしで詠唱する。" },
  spillover: { name: "スピルオーバー", description: "この呪文で倒した敵は、燃焼・冷気・毒を近くの敵へ移しながら倒れる。" },
  drag: { name: "ドラッグ", description: "当てた敵を弾き飛ばさず自分の方へ引き寄せ、剣の間合いに入れる。" },

  /* --------------------------------- stats ------------------------------- */
  fleet: { name: "俊足", description: "移動が速くなる。" },
  second_wind: { name: "息継ぎ", description: "ダッシュのクールダウンが短くなる。" },
  long_stride: { name: "大股", description: "ダッシュの距離が伸びる。" },
  wrath: { name: "憤怒", description: "怒りゲージが増え、回転斬りを多く溜められる。" },
  vigour: { name: "頑健", description: "最大 HP が上がり、全回復する。" },
  steady_nerve: { name: "胆力", description: "被弾後の無敵時間が長くなる。" },
  deep_well: { name: "深き泉", description: "最大マナが上がる。" },
  quickening: { name: "湧き出し", description: "マナの自然回復が速くなる。" },
  leeching_edge: { name: "吸魔の刃", description: "剣が当たったときのマナ回復が増える。" },
  keen_edge: { name: "鋭刃", description: "剣の威力が上がる。" },
  long_reach: { name: "長刃", description: "剣を振る範囲が広がる。" },
  swift_hand: { name: "早業", description: "剣を振ったあとの隙と、連撃のあとの間が短くなる。" },

  /* -------------------------------- schools ------------------------------ */
  flame: { name: "炎" },
  frost: { name: "氷" },
  venom: { name: "毒" },
  storm: { name: "雷" },
  void: { name: "虚空" },
  spirit: { name: "霊" },
  stone: { name: "岩" },

  /* --------------------------------- styles ------------------------------ */
  "style.spam": { name: "弾幕", description: "安い呪文を途切れなく撃ち続ける。連鎖し広がる弾で、画面を埋め尽くす。" },
  "style.nuke": { name: "一撃", description: "手数は少なく、一発が重い。遅くて高い呪文を狙って当て、戦いを終わらせる。" },
  "style.area": { name: "範囲", description: "爆発・輪・床の効果で、多くの敵をまとめて攻撃する。" },
  "style.dot": { name: "継続", description: "燃焼と毒で継続ダメージを与え、動き回りながら戦う。" },
  "style.melee": { name: "剣戟", description: "剣の間合いで戦う。周囲を巡る呪文や、剣を振ると発動する呪文を使う。" },
};
