/**
 * 简体中文 content: names and descriptions keyed by the id `core` uses.
 *
 * Core keeps its English — the harness reads it, the tests match it, and it
 * is what the Director is sent — so this is a lookup beside it rather than a
 * replacement for it. An id missing here falls back to core's English, which
 * is how English costs nothing and how a half-finished language still plays.
 *
 * Names are kept identical wherever a spell appears: the card, the action
 * bar, the character screen and the toast all read the same two or three
 * characters, because a player learns a spell by its name long before they
 * read what it does.
 */
import type { ContentTable } from "./index.ts";

export const ZH_CONTENT: ContentTable = {
  /* -------------------------------- attacks ------------------------------ */
  magic_bolt: { name: "魔法飞弹", description: "最省法力的单发飞弹，出手快。" },
  shock_arc: { name: "电弧", description: "电火花命中后会跳向附近最多两个敌人，每跳一次伤害减半。敌人扎堆时好用。" },
  spark_spray: { name: "火花喷射", description: "在身前扇形喷出一片火花，覆盖面广。" },
  stone_shard: { name: "碎石", description: "抛出一块碎石，是普通品质攻击法术中单发伤害最高的。" },
  earth_spikes: { name: "地刺", description: "沿直线依次顶出一排石刺，被刺中的敌人会踉跄。敌人排成一线时最好用。" },
  flame_pillars: { name: "火柱", description: "沿直线依次升起一排火柱，火柱烧过的地面会烧上一阵。" },
  cinder_geysers: { name: "熔火喷泉", description: "在目标脚下和周围接连喷出火焰，专治一群敌人。" },
  ember_dart: { name: "火镖", description: "命中后点燃目标。" },
  frost_needle: { name: "冰针", description: "命中后冰缓目标，使其减速。" },
  venom_spit: { name: "毒液喷射", description: "命中会留下可叠加的毒，出手越快毒叠得越厚。" },
  arc_lance: { name: "雷枪", description: "掷出一杆飞快的雷枪，能贯穿敌人。" },
  scatter_shot: { name: "霰弹", description: "近距离喷出一片弹丸，离得越近打中越多。" },
  cinder_burst: { name: "双火种", description: "射出两枚燃烧的火种，但很费法力。" },
  glacier_spike: { name: "冰川尖刺", description: "刺出一根巨大的冰锥，命中的敌人会被减速。" },
  void_orb: { name: "虚空球", description: "缓慢而沉重地飘出去，穿过路上的一切并把敌人撞开。冷却很长。" },
  plague_bloom: { name: "疫病孢子", description: "撒出一片孢子，碰到就中毒。" },
  spirit_blades: { name: "灵刃", description: "召出三把绕身旋转的刀刃，切割碰到的一切。再放一次会重置，不会叠加。越往人堆里钻越好用。" },
  wildfire_field: { name: "野火", description: "点燃最近敌人脚下的地面，火熄灭之前踏进去的都会着火。用来封住一块地方。" },
  blink_strike: { name: "闪身斩", description: "向前闪身，穿过路上的敌人并各砍一刀，闪身途中无敌。既是攻击也是闪避。" },
  void_maw: { name: "虚空漩涡", description: "在最近的敌人脚下撕开漩涡，几秒内把周围的敌人往中间拖并持续造成伤害。把散开的敌人聚到剑下。" },
  spirit_ally: { name: "灵魂随从", description: "召来一个跟在身后的灵魂，一段时间内自动射击最近的敌人。你专心躲，它负责打。" },
  frost_nova: { name: "冰霜新星", description: "以自身为中心炸开一圈冰刃，冻住附近的敌人。被围住时的救命招，隔得远就白放了。" },
  seeker_swarm: { name: "追踪飞镖", description: "放出一群会自己找目标的飞镖。打单体不划算，但从不落空。" },
  fault_line: { name: "断层", description: "推出一道贯穿整条直线的石刃。敌人排成一列时最好用，打单个一般。" },
  stone_ward: { name: "石柱", description: "在身前升起一根石柱，推开并伤害旁边的敌人。石柱被打坏之前，能挡住敌人和子弹。" },
  mana_darts: { name: "蓄能飞镖", description: "不按键时逐枚蓄积飞镖，最多五枚。按下后把蓄好的飞镖一齐扇形射出，并追踪前方的敌人。" },
  arcane_cannon: { name: "奥术炮", description: "按住蓄力，松开发射一发贯穿敌人的炮弹，蓄得越久越大，蓄满能让敌人踉跄。蓄力时移动变慢；闪避会取消蓄力，且不消耗法力。" },
  doom_sigil: { name: "厄运印记", description: "给命中的敌人打上印记，数秒后印记爆发，伤到它和身边的敌人。印记爆发前，同一个敌人无法再被标记。" },
  frozen_orb: { name: "冰封球", description: "发出一颗缓慢的冰球，穿过沿途的敌人，飞行时向四周甩出冰片，最后炸成一圈冰片。" },
  contagion: { name: "传染", description: "射出一团浓毒。中毒的敌人死去时，毒会跳到附近几个敌人身上，再从它们身上继续传开。" },
  meteor: { name: "陨石", description: "在目标敌人脚下标出落点，片刻后燃烧的陨石砸进标记，并让地面燃烧。敌人可以走出标记。" },
  quake_ring: { name: "震地环", description: "以自身为中心，一圈接一圈地震裂地面，被震到的敌人会踉跄。" },
  leap_slam: { name: "跃击", description: "跃向目标敌人，空中无敌，落地时震出一圈碎裂的地面。" },
  ball_lightning: { name: "球状闪电", description: "从手中放出一颗缓缓漂移的雷球，每秒数次电击范围内最近的敌人。可以同时存在几颗，新放的会顶替最早的一颗。" },
  returning_edge: { name: "回旋刃", description: "向前掷出一把灵体之剑，减速、折返，飞回你此刻所在的位置。去程和回程各砍中每个敌人一次。" },
  crescent_edge: { name: "新月剑气", description: "一段时间内，每次挥剑（无论是否命中）都会向前甩出一道新月剑气，穿过范围内的所有敌人。再次施放会刷新时间。" },
  counter_stance: { name: "反击架势", description: "摆出短暂的架势：移动变慢，不能挥剑。下一次将要命中你的攻击会被抵消，并以一记回旋斩反击，让敌人踉跄。若没有被击中，架势结束时以较弱的回旋斩反击。" },
  cinder_stride: { name: "余烬步", description: "数秒内，你走过的地面会燃起火焰：每走一步留下一块，站着不动就不留。自己的火永远烧不到自己。" },
  toxic_cloud: { name: "毒雾", description: "在最近的敌人脚下放出一团毒雾，让站在其中的敌人中毒并减速。" },

  /* -------------------------------- affixes ------------------------------ */
  fork: { name: "分叉", description: "命中后裂成几块碎片继续向前飞。" },
  chain: { name: "连锁", description: "命中后向附近的下一个敌人放出一枚缩小、减弱的同款法术。敌人越聚越好用。" },
  brand: { name: "烙印", description: "第一下打上标记，第二下引爆它。适合盯着一个目标打。" },
  harvest: { name: "收割", description: "用它击杀的敌人会炸开。" },
  bloom: { name: "绽放", description: "弹丸飞到尽头时点燃地面，站在上面的敌人会被烧着。打空了也不浪费。" },
  shatter: { name: "碎裂", description: "打到墙和杂物也会炸开碎片。房间越乱越好用。" },
  repeat: { name: "回响", description: "施放后隔一拍，朝你当时瞄准的方向再自动施放一次。" },
  scatter: { name: "散射", description: "法术同时向四周射出。被围住时的解法，没被围时没什么用。" },
  ward: { name: "守护", description: "施法时在脚下留下一道符文，挡住敌人的子弹。" },
  retort: { name: "还击", description: "受到伤害时，免费对打你的敌人放一次这个法术。" },
  slipstream: { name: "尾流", description: "闪避穿过敌人时会顺势攻击它。" },
  pierce: { name: "穿透", description: "弹丸会穿过命中的敌人继续飞。" },
  seek: { name: "追踪", description: "弹丸会拐向最近的敌人。" },
  ricochet: { name: "弹跳", description: "弹丸撞墙会弹回房间里。" },
  kindle: { name: "引燃", description: "命中额外积累灼烧，和法术原本的元素并存；本就带火的法术烧得更快。身上同时挂着两种不同元素的敌人，受到的每次伤害都会更高。" },
  rime: { name: "霜冻", description: "命中额外积累冰冻，和法术原本的元素并存；冻住的敌人被打碎时受三倍伤害。身上同时挂着两种不同元素的敌人，受到的每次伤害都会更高。" },
  blight: { name: "枯萎", description: "命中额外积累中毒，和法术原本的元素并存；中毒会减速并慢慢消耗敌人。身上同时挂着两种不同元素的敌人，受到的每次伤害都会更高。" },
  haste: { name: "急速", description: "用它击杀敌人时，冷却恢复更快。" },
  resonance: { name: "共鸣", description: "挥剑连续命中几次后，自动免费对被砍的敌人放一次这个法术。" },

  /* --------------------------------- stats ------------------------------- */
  fleet: { name: "轻盈", description: "移动更快。" },
  second_wind: { name: "回气", description: "闪避冷却更短。" },
  long_stride: { name: "阔步", description: "闪避距离更远。" },
  wrath: { name: "怒火", description: "怒气多一格，回旋斩能多攒一次。" },
  vigour: { name: "体魄", description: "生命上限提高，并立即回满。" },
  steady_nerve: { name: "镇定", description: "受击后的无敌时间更长。" },
  deep_well: { name: "深泉", description: "法力上限提高。" },
  quickening: { name: "回流", description: "法力自然回复更快。" },
  leeching_edge: { name: "吸魔之刃", description: "挥剑命中时回复更多法力。" },
  keen_edge: { name: "利刃", description: "剑的伤害提高。" },
  long_reach: { name: "长刃", description: "挥剑的范围更大。" },
  swift_hand: { name: "快剑", description: "挥剑后恢复更快，连段之间的停顿也更短。" },

  /* -------------------------------- schools ------------------------------ */
  flame: { name: "火焰" },
  frost: { name: "寒冰" },
  venom: { name: "剧毒" },
  storm: { name: "雷电" },
  void: { name: "虚空" },
  spirit: { name: "灵魂" },
  stone: { name: "岩石" },

  /* --------------------------------- styles ------------------------------ */
  "style.spam": { name: "弹幕", description: "法术又便宜又快，一刻不停地放。连锁、扇射，打满全屏。" },
  "style.nuke": { name: "重击", description: "出手不多，但每一下都要命。法术慢而贵，放准了就能结束战斗。" },
  "style.area": { name: "群攻", description: "一下打一片。爆炸、光环和地面效果，敌人越扎堆越爽。" },
  "style.dot": { name: "侵蚀", description: "点火、下毒，让伤害慢慢跳，你只管跑位。" },
  "style.melee": { name: "近战", description: "贴身作战。环绕和近身的法术，由剑来施放。" },
};
